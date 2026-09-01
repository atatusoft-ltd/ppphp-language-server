import path from "node:path";
import { pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  pathIsWithin,
  prepareTypeRenameAt,
  renameTypeAt,
  type PrepareTypeRenameResult,
  type RenameServices,
  type TypeRenameResult,
} from "./compiler-rename.js";
import { DEFAULT_SETTINGS } from "./server-settings.js";

const REQUEST_VERSION = 1;
const MAXIMUM_TRANSPORT_BYTES = 16 * 1024 * 1024;
const MAXIMUM_DOCUMENT_BYTES = 2_097_152;
const MAXIMUM_OPEN_DOCUMENTS = 128;

interface RenameCommandDocument {
  path: string;
  contents: string;
  version: number;
}

interface RenameCommandRequest {
  document: RenameCommandDocument;
  openDocuments: RenameCommandDocument[];
  positionOffset: number;
  newName?: string;
}

export interface RenameCommandResponse {
  version: number;
  edit: TypeRenameResult["edit"];
  prepare?: PrepareTypeRenameResult["prepare"];
  error: { code: string; message: string } | null;
}

export async function runRenameCommand(
  workspaceRoot: string = process.cwd(),
  services: Partial<RenameServices> = {},
): Promise<RenameCommandResponse> {
  try {
    return executeRenameCommand(await readStandardInput(), workspaceRoot, services);
  } catch (error) {
    return errorResponse("invalid-request", error instanceof Error ? error.message : String(error));
  }
}

export async function executeRenameCommand(
  input: string,
  workspaceRoot: string,
  services: Partial<RenameServices> = {},
): Promise<RenameCommandResponse> {
  try {
    const request = decodeRenameCommandRequest(input, workspaceRoot);
    const document = toTextDocument(request.document);
    if (request.newName === undefined) {
      const result = await prepareTypeRenameAt(
        document,
        document.positionAt(request.positionOffset),
        request.document.path,
        path.resolve(workspaceRoot),
        DEFAULT_SETTINGS,
        services,
      );
      return result.unavailableReason
        ? errorResponse("unavailable", result.unavailableReason)
        : { version: REQUEST_VERSION, edit: null, prepare: result.prepare, error: null };
    }

    const openDocuments = request.openDocuments.map(toTextDocument);
    if (!openDocuments.some((candidate) => candidate.uri === document.uri)) {
      openDocuments.push(document);
    }

    const result = await renameTypeAt(
      document,
      document.positionAt(request.positionOffset),
      request.newName,
      request.document.path,
      path.resolve(workspaceRoot),
      DEFAULT_SETTINGS,
      openDocuments,
      { documentChanges: true, renameFileOperations: true },
      services,
    );
    const message = result.rejectionReason ?? result.unavailableReason;
    return message
      ? errorResponse(result.unavailableReason ? "unavailable" : "rename-refused", message)
      : { version: REQUEST_VERSION, edit: result.edit, error: null };
  } catch (error) {
    return errorResponse("invalid-request", error instanceof Error ? error.message : String(error));
  }
}

export function decodeRenameCommandRequest(
  input: string,
  workspaceRoot: string,
): RenameCommandRequest {
  const payload = decodePayload(input);
  const document = decodeDocument(payload.document, workspaceRoot);
  const positionOffset = decodePositionOffset(payload.position, document);
  const newName = payload.newName;
  const rawOpenDocuments = payload.openDocuments ?? [];

  if (
    newName !== undefined &&
    (typeof newName !== "string" || newName.length === 0 || newName.length > 255)
  ) {
    throw new Error("The ++PHP rename request requires a replacement name.");
  }
  if (!Array.isArray(rawOpenDocuments) || rawOpenDocuments.length > MAXIMUM_OPEN_DOCUMENTS) {
    throw new Error(
      `The ++PHP rename request supports at most ${MAXIMUM_OPEN_DOCUMENTS} open documents.`,
    );
  }

  return {
    document,
    openDocuments: rawOpenDocuments.map((candidate) => decodeDocument(candidate, workspaceRoot)),
    positionOffset,
    ...(newName === undefined ? {} : { newName }),
  };
}

async function readStandardInput(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input, "utf8") > MAXIMUM_TRANSPORT_BYTES) {
      throw new Error("The ++PHP rename request exceeds sixteen megabytes.");
    }
  }
  return input;
}

function decodeDocument(value: unknown, workspaceRoot: string): RenameCommandDocument {
  const document = asRecord(value);
  const requestedPath = document?.path;
  const contents = document?.contents;
  const version = document?.version ?? 0;
  if (
    typeof requestedPath !== "string" ||
    typeof contents !== "string" ||
    !Number.isInteger(version) ||
    (version as number) < 0
  ) {
    throw new Error(
      "Each ++PHP rename document requires path, contents, and a non-negative version.",
    );
  }
  if (Buffer.byteLength(contents, "utf8") > MAXIMUM_DOCUMENT_BYTES) {
    throw new Error("A ++PHP rename document exceeds two megabytes.");
  }

  const projectRoot = path.resolve(workspaceRoot);
  const filePath = path.resolve(projectRoot, requestedPath);
  if (path.extname(filePath).toLowerCase() !== ".ppphp" || !pathIsWithin(projectRoot, filePath)) {
    throw new Error("The ++PHP rename document must be a .ppphp file inside the workspace.");
  }

  return { path: filePath, contents, version: version as number };
}

function decodePayload(input: string): Record<string, unknown> {
  if (Buffer.byteLength(input, "utf8") > MAXIMUM_TRANSPORT_BYTES) {
    throw new Error("The ++PHP rename request exceeds sixteen megabytes.");
  }

  const payload = asRecord(JSON.parse(input));
  if (payload?.version !== REQUEST_VERSION) {
    throw new Error("The ++PHP rename request version is unsupported.");
  }
  return payload;
}

function decodePositionOffset(value: unknown, document: RenameCommandDocument): number {
  const positionOffset = asRecord(value)?.offset;
  if (!Number.isInteger(positionOffset) || (positionOffset as number) < 0) {
    throw new Error("The ++PHP rename request position is invalid.");
  }
  if ((positionOffset as number) > document.contents.length) {
    throw new Error("The ++PHP rename request position is outside the current document.");
  }
  return positionOffset as number;
}

function toTextDocument(document: RenameCommandDocument): TextDocument {
  return TextDocument.create(
    pathToFileURL(document.path).toString(),
    "ppphp",
    document.version,
    document.contents,
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function errorResponse(code: string, message: string): RenameCommandResponse {
  return {
    version: REQUEST_VERSION,
    edit: null,
    error: { code, message },
  };
}
