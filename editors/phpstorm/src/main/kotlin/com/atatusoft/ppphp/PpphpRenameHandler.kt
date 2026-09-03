package com.atatusoft.ppphp

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.execution.process.CapturingProcessHandler
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.ui.InputValidator
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vfs.ReadonlyStatusHandler
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFile
import com.intellij.refactoring.rename.RenameHandler
import java.net.URI
import java.nio.charset.StandardCharsets
import java.nio.file.Path

class PpphpRenameHandler internal constructor(
    private val prepareRename: (Project, Editor, VirtualFile, Int) -> Boolean,
) : RenameHandler {
    constructor() : this(PpphpRenameSupport::canRename)

    override fun isAvailableOnDataContext(dataContext: DataContext): Boolean {
        val project = CommonDataKeys.PROJECT.getData(dataContext) ?: return false
        val editor = CommonDataKeys.EDITOR.getData(dataContext) ?: return false
        val file = findVirtualFile(dataContext) ?: return false
        val identifier = PpphpRenameSupport.findIdentifier(
            editor.document.text,
            editor.caretModel.offset,
        ) ?: return false

        return file.extension.equals("ppphp", ignoreCase = true) &&
            runCatching { prepareRename(project, editor, file, identifier.start) }.getOrDefault(false)
    }

    override fun invoke(
        project: Project,
        editor: Editor,
        file: PsiFile,
        dataContext: DataContext,
    ) {
        val virtualFile = file.virtualFile ?: findVirtualFile(dataContext) ?: return
        val identifier =
            PpphpRenameSupport.findIdentifier(editor.document.text, editor.caretModel.offset)
                ?: return
        val newName = Messages.showInputDialog(
            project,
            "Enter a new name for ${identifier.name}:",
            "Rename ++PHP Type",
            Messages.getQuestionIcon(),
            identifier.name,
            PpphpTypeNameValidator,
        ) ?: return
        val projectRoot = PpphpRenameSupport.projectRoot(project) ?: return
        val pluginRoot = PpphpLanguageServerRuntime.findPluginRoot(javaClass)
        if (pluginRoot == null) {
            Messages.showErrorDialog(project, "The ++PHP plugin installation could not be resolved.", "Rename ++PHP Type")
            return
        }

        var response: PpphpNativeRename? = null
        var failure: String? = null
        val completed = ProgressManager.getInstance().runProcessWithProgressSynchronously(
            {
                try {
                    val request = PpphpRenameSupport.buildRequest(
                        projectRoot,
                        virtualFile,
                        editor.document,
                        identifier.start,
                    )
                    response = PpphpRenameSupport.requestRename(
                        pluginRoot,
                        projectRoot,
                        request,
                        newName,
                    )
                } catch (exception: Exception) {
                    failure = exception.message ?: exception.javaClass.simpleName
                }
            },
            "Renaming ++PHP Type",
            true,
            project,
        )

        if (!completed) return
        if (failure != null) {
            Messages.showErrorDialog(project, failure, "Rename ++PHP Type")
            return
        }
        val rename = response ?: return
        val files = rename.textEdits.map(PpphpNativeTextEdits::file) + listOfNotNull(rename.fileRename?.file)
        if (ReadonlyStatusHandler.getInstance(project).ensureFilesWritable(files).hasReadonlyFiles()) return

        try {
            WriteCommandAction.runWriteCommandAction(
                project,
                "Rename ++PHP Type",
                null,
                {
                    for (documentEdits in rename.textEdits) {
                        for (edit in documentEdits.edits.sortedByDescending(PpphpNativeTextEdit::start)) {
                            documentEdits.document.replaceString(edit.start, edit.end, edit.newText)
                        }
                    }
                    rename.fileRename?.let { fileRename ->
                        fileRename.file.rename(this, fileRename.newName)
                    }
                },
            )
        } catch (exception: Exception) {
            Messages.showErrorDialog(
                project,
                exception.message ?: "The ++PHP rename could not be applied.",
                "Rename ++PHP Type",
            )
        }
    }

    override fun invoke(
        project: Project,
        elements: Array<out PsiElement>,
        dataContext: DataContext,
    ) {
        val editor = CommonDataKeys.EDITOR.getData(dataContext) ?: return
        val file = CommonDataKeys.PSI_FILE.getData(dataContext) ?: return
        invoke(project, editor, file, dataContext)
    }

    private fun findVirtualFile(dataContext: DataContext): VirtualFile? =
        CommonDataKeys.VIRTUAL_FILE.getData(dataContext)
            ?: CommonDataKeys.PSI_FILE.getData(dataContext)?.virtualFile
}

internal object PpphpRenameSupport {
    private const val PROCESS_TIMEOUT_MILLISECONDS = 60_000

    @Volatile
    private var cachedPreparation: PpphpCachedPreparation? = null

    fun canRename(
        project: Project,
        editor: Editor,
        file: VirtualFile,
        positionOffset: Int,
    ): Boolean {
        val key = PpphpPreparationKey(file.path, editor.document.modificationStamp, positionOffset)
        cachedPreparation?.takeIf { it.key == key }?.let { return it.available }

        val projectRoot = projectRoot(project) ?: return false
        val pluginRoot = PpphpLanguageServerRuntime.findPluginRoot(PpphpRenameHandler::class.java)
            ?: return false
        val available = requestPrepareRename(
            pluginRoot,
            projectRoot,
            buildRequest(projectRoot, file, editor.document, positionOffset),
        )
        cachedPreparation = PpphpCachedPreparation(key, available)
        return available
    }

    fun findIdentifier(source: String, requestedOffset: Int): PpphpIdentifier? {
        if (source.isEmpty()) return null
        var start = requestedOffset.coerceIn(0, source.length)
        if (!isIdentifierPart(source.getOrNull(start)) && isIdentifierPart(source.getOrNull(start - 1))) {
            start--
        }
        if (!isIdentifierPart(source.getOrNull(start))) return null

        var end = start
        while (start > 0 && isIdentifierPart(source[start - 1])) start--
        while (end < source.length && isIdentifierPart(source[end])) end++
        val name = source.substring(start, end)

        return name.takeIf(::isIdentifier)?.let { PpphpIdentifier(it, start, end) }
    }

    fun buildRequest(
        projectRoot: VirtualFile,
        file: VirtualFile,
        document: Document,
        positionOffset: Int,
    ): JsonObject {
        val request = JsonObject()
        request.addProperty("version", 1)
        request.add("document", encodeDocument(file, document))
        request.add("position", JsonObject().also { it.addProperty("offset", positionOffset) })

        val openDocuments = JsonArray()
        val manager = FileDocumentManager.getInstance()
        for (openDocument in manager.unsavedDocuments) {
            val openFile = manager.getFile(openDocument) ?: continue
            if (
                openFile.extension.equals("ppphp", ignoreCase = true) &&
                VfsUtilCore.isAncestor(projectRoot, openFile, false) &&
                openFile != file
            ) {
                openDocuments.add(encodeDocument(openFile, openDocument))
            }
        }
        request.add("openDocuments", openDocuments)
        return request
    }

    fun requestRename(
        pluginRoot: Path,
        projectRoot: VirtualFile,
        request: JsonObject,
        newName: String,
    ): PpphpNativeRename {
        request.addProperty("newName", newName)
        return parseResponse(runNativeCommand(pluginRoot, projectRoot, request, "--rename"), projectRoot)
    }

    fun requestPrepareRename(
        pluginRoot: Path,
        projectRoot: VirtualFile,
        request: JsonObject,
    ): Boolean {
        val response = JsonParser.parseString(
            runNativeCommand(pluginRoot, projectRoot, request, "--rename"),
        ).asJsonObject
        if (response.get("version")?.asInt != 1 || response.get("error")?.isJsonObject == true) {
            return false
        }
        return response.get("prepare")?.isJsonObject == true
    }

    fun parseResponse(output: String, projectRoot: VirtualFile): PpphpNativeRename {
        val response = JsonParser.parseString(output).asJsonObject
        if (response.get("version")?.asInt != 1) {
            throw IllegalStateException("The ++PHP rename response version is unsupported.")
        }
        response.get("error")?.takeUnless { it.isJsonNull }?.asJsonObject?.let { error ->
            throw IllegalStateException(error.get("message")?.asString ?: "The ++PHP rename was refused.")
        }
        val changes = response.getAsJsonObject("edit")?.getAsJsonArray("documentChanges")
            ?: throw IllegalStateException("The ++PHP rename response contains no edits.")
        val textEdits = mutableListOf<PpphpNativeTextEdits>()
        var fileRename: PpphpNativeFileRename? = null

        for (change in changes) {
            val operation = change.asJsonObject
            if (operation.get("kind")?.asString == "rename") {
                if (fileRename != null) {
                    throw IllegalStateException("The ++PHP rename response contains multiple file renames.")
                }
                fileRename = parseFileRename(operation, projectRoot)
            } else {
                textEdits += parseTextEdits(operation, projectRoot)
            }
        }
        if (textEdits.isEmpty()) {
            throw IllegalStateException("The ++PHP rename response contains no text edits.")
        }

        return PpphpNativeRename(textEdits, fileRename)
    }

    private fun parseTextEdits(operation: JsonObject, root: VirtualFile): PpphpNativeTextEdits {
        val uri = operation.getAsJsonObject("textDocument")?.get("uri")?.asString
            ?: throw IllegalStateException("A ++PHP rename edit has no document URI.")
        val file = resolveProjectFile(uri, root)
        val document = FileDocumentManager.getInstance().getDocument(file)
            ?: throw IllegalStateException("The ++PHP rename document could not be opened: ${file.path}")
        val edits = operation.getAsJsonArray("edits")?.map { rawEdit ->
            val edit = rawEdit.asJsonObject
            val range = edit.getAsJsonObject("range")
                ?: throw IllegalStateException("A ++PHP rename text edit has no range.")
            val start = resolveOffset(document, range.getAsJsonObject("start"))
            val end = resolveOffset(document, range.getAsJsonObject("end"))
            val newText = edit.get("newText")?.asString
                ?: throw IllegalStateException("A ++PHP rename text edit has no replacement text.")
            if (end < start) throw IllegalStateException("A ++PHP rename text edit range is reversed.")
            PpphpNativeTextEdit(start, end, newText)
        } ?: throw IllegalStateException("A ++PHP rename document has no edits.")

        val ordered = edits.sortedBy(PpphpNativeTextEdit::start)
        if (ordered.zipWithNext().any { (left, right) -> left.end > right.start }) {
            throw IllegalStateException("The ++PHP rename response contains overlapping edits.")
        }
        return PpphpNativeTextEdits(file, document, edits)
    }

    private fun parseFileRename(operation: JsonObject, root: VirtualFile): PpphpNativeFileRename {
        val oldUri = operation.get("oldUri")?.asString
            ?: throw IllegalStateException("The ++PHP file rename has no source URI.")
        val newUri = operation.get("newUri")?.asString
            ?: throw IllegalStateException("The ++PHP file rename has no destination URI.")
        val file = resolveProjectFile(oldUri, root)
        val source = URI(oldUri).normalize()
        val destination = URI(newUri).normalize()
        val destinationName = destination.path?.substringAfterLast('/')
            ?.takeIf(String::isNotEmpty)
            ?: throw IllegalStateException("The ++PHP file rename destination is invalid.")
        if (
            destination.query != null ||
            destination.fragment != null ||
            !source.scheme.equals(destination.scheme, ignoreCase = true) ||
            source.authority != destination.authority ||
            source.path?.substringBeforeLast('/') != destination.path.substringBeforeLast('/') ||
            !destinationName.endsWith(".ppphp", ignoreCase = true)
        ) {
            throw IllegalStateException("The ++PHP file rename destination is invalid.")
        }
        val existing = VirtualFileManager.getInstance().findFileByUrl(newUri)
        if (existing != null && existing != file) {
            throw IllegalStateException("The ++PHP file rename would overwrite $destinationName.")
        }

        return PpphpNativeFileRename(file, destinationName)
    }

    private fun resolveProjectFile(uri: String, root: VirtualFile): VirtualFile {
        val file = VirtualFileManager.getInstance().findFileByUrl(uri)
            ?: throw IllegalStateException("The ++PHP rename file could not be found: $uri")
        if (
            !VfsUtilCore.isAncestor(root, file, false) ||
            !file.extension.equals("ppphp", ignoreCase = true)
        ) {
            throw IllegalStateException("The ++PHP rename response targets a file outside the project.")
        }
        return file
    }

    private fun resolveOffset(document: Document, position: JsonObject?): Int {
        val line = position?.get("line")?.asInt
            ?: throw IllegalStateException("A ++PHP rename position has no line.")
        val character = position.get("character")?.asInt
            ?: throw IllegalStateException("A ++PHP rename position has no character.")
        if (line !in 0 until document.lineCount || character < 0) {
            throw IllegalStateException("A ++PHP rename position is outside its document.")
        }
        val start = document.getLineStartOffset(line)
        val end = document.getLineEndOffset(line)
        return (start + character).takeIf { it <= end }
            ?: throw IllegalStateException("A ++PHP rename position is outside its line.")
    }

    private fun encodeDocument(file: VirtualFile, document: Document): JsonObject =
        JsonObject().also { encoded ->
            encoded.addProperty("path", file.toNioPath().toAbsolutePath().normalize().toString())
            encoded.addProperty("contents", document.text)
            encoded.addProperty("version", document.modificationStamp.coerceAtLeast(0))
        }

    private fun runNativeCommand(
        pluginRoot: Path,
        projectRoot: VirtualFile,
        request: JsonObject,
        command: String,
    ): String {
        val commandLine = PpphpLanguageServerRuntime.createCommandLine(
            pluginRoot,
            projectRoot.toNioPath().toAbsolutePath().normalize().toString(),
            command,
        )
        val handler = CapturingProcessHandler(commandLine)
        handler.processInput.use { input ->
            input.write(request.toString().toByteArray(StandardCharsets.UTF_8))
            input.flush()
        }
        val output = handler.runProcess(PROCESS_TIMEOUT_MILLISECONDS)
        if (output.isTimeout) throw IllegalStateException("The ++PHP rename request timed out.")
        if (output.exitCode != 0) {
            throw IllegalStateException(output.stderr.trim().ifEmpty { "The ++PHP rename process failed." })
        }
        return output.stdout
    }

    fun projectRoot(project: Project): VirtualFile? =
        project.guessProjectDir()?.takeIf(VirtualFile::isValid)

    private fun isIdentifier(value: String): Boolean =
        value.isNotEmpty() && isIdentifierStart(value[0]) && value.drop(1).all(::isIdentifierPart)

    private fun isIdentifierStart(character: Char?): Boolean =
        character != null && (character == '_' || character in 'A'..'Z' || character in 'a'..'z')

    private fun isIdentifierPart(character: Char?): Boolean =
        isIdentifierStart(character) || character != null && character in '0'..'9'
}

internal data class PpphpIdentifier(val name: String, val start: Int, val end: Int)

private data class PpphpPreparationKey(
    val filePath: String,
    val modificationStamp: Long,
    val positionOffset: Int,
)

private data class PpphpCachedPreparation(
    val key: PpphpPreparationKey,
    val available: Boolean,
)

internal data class PpphpNativeRename(
    val textEdits: List<PpphpNativeTextEdits>,
    val fileRename: PpphpNativeFileRename?,
)

internal data class PpphpNativeTextEdits(
    val file: VirtualFile,
    val document: Document,
    val edits: List<PpphpNativeTextEdit>,
)

internal data class PpphpNativeTextEdit(val start: Int, val end: Int, val newText: String)

internal data class PpphpNativeFileRename(val file: VirtualFile, val newName: String)

private object PpphpTypeNameValidator : InputValidator {
    override fun checkInput(inputString: String): Boolean =
        inputString.matches(Regex("[A-Za-z_][A-Za-z0-9_]*"))

    override fun canClose(inputString: String): Boolean = checkInput(inputString)
}
