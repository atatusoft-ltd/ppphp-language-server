import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { documentSymbols, hoverAt, maskNonCode } from "../src/language-features.js";

describe("language features", () => {
  it("finds declarations but ignores comments and strings", () => {
    const document = TextDocument.create(
      "file:///example.ppphp",
      "ppphp",
      1,
      `<?php
// class Decoy {}
$value = "function alsoDecoy()";
namespace Example\\Demo;
class Box<T> {}
interface Repository<T> {}
function identity<T>(T $value): T { return $value; }
`,
    );

    expect(documentSymbols(document).map(({ name }) => name)).toEqual([
      "Example\\Demo",
      "Box",
      "Repository",
      "identity",
    ]);
  });

  it("preserves line endings while masking non-code regions", () => {
    const source = `#[Example]
class Real {}
# class Fake {}
'function hidden()'
$heredoc = <<<TEXT
class HeredocDecoy {}
    TEXT . strtoupper('suffix');
class AfterHeredoc {}
$nowdoc = <<<'TEXT'
interface NowdocDecoy {}
TEXT;
`;
    const masked = maskNonCode(source);
    expect(masked.split("\n")).toHaveLength(source.split("\n").length);
    expect(masked).toContain("#[Example]");
    expect(masked).toContain("class Real");
    expect(masked).not.toContain("Fake");
    expect(masked).not.toContain("hidden");
    expect(masked).not.toContain("HeredocDecoy");
    expect(masked).not.toContain("NowdocDecoy");
    expect(masked).toContain("strtoupper");
    expect(masked).toContain("AfterHeredoc");
  });

  it("preserves UTF-16 offsets after astral characters", () => {
    const document = TextDocument.create(
      "file:///unicode.ppphp",
      "ppphp",
      1,
      "<?php\n$message = '👋';\nclass Greeting {}\n",
    );
    const greeting = documentSymbols(document)[0];
    expect(greeting?.name).toBe("Greeting");
    expect(greeting?.selectionRange.start).toEqual({ line: 2, character: 6 });
  });

  it("provides hover help for ++PHP contextual keywords", () => {
    const document = TextDocument.create(
      "file:///example.ppphp",
      "ppphp",
      1,
      "string $label = when ($ready) { return 'yes'; } else { return 'no'; };",
    );
    expect(hoverAt(document, { line: 0, character: 18 })).not.toBeNull();
    expect(hoverAt(document, { line: 0, character: 0 })).toBeNull();
  });
});
