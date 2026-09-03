package com.atatusoft.ppphp

import com.intellij.codeInsight.intention.IntentionAction
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.project.Project
import com.intellij.platform.lsp.api.LspServerManager
import com.intellij.psi.PsiDocumentManager
import com.intellij.psi.PsiFile
import com.intellij.util.IncorrectOperationException
import org.eclipse.lsp4j.CodeAction
import org.eclipse.lsp4j.CodeActionContext
import org.eclipse.lsp4j.CodeActionParams
import org.eclipse.lsp4j.Command
import org.eclipse.lsp4j.Diagnostic
import org.eclipse.lsp4j.Position
import org.eclipse.lsp4j.Range
import org.eclipse.lsp4j.TextEdit
import org.eclipse.lsp4j.jsonrpc.messages.Either

class PpphpImportIntention : IntentionAction {
    override fun getText(): String = "Use import"

    override fun getFamilyName(): String = "++PHP imports"

    override fun isAvailable(project: Project, editor: Editor, file: PsiFile): Boolean =
        file.fileType == PpphpFileType.INSTANCE &&
            !editor.isViewer &&
            requestActions(editor, file, AVAILABILITY_TIMEOUT_MILLISECONDS).isNotEmpty()

    @Throws(IncorrectOperationException::class)
    override fun invoke(project: Project, editor: Editor, file: PsiFile) {
        val requested = requestActions(editor, file, INVOCATION_TIMEOUT_MILLISECONDS).singleOrNull()
            ?: return
        val edits = requested.action.edit?.changes?.get(requested.uri).orEmpty()
            .map { edit -> resolveEdit(editor.document, edit) ?: return }
            .sortedByDescending(ResolvedEdit::start)
        if (edits.isEmpty()) return

        WriteCommandAction.runWriteCommandAction(project, "Use ++PHP import", null, {
            for (edit in edits) {
                editor.document.replaceString(edit.start, edit.end, edit.text)
            }
            PsiDocumentManager.getInstance(project).commitDocument(editor.document)
        }, file)
    }

    override fun startInWriteAction(): Boolean = false

    private fun requestActions(
        editor: Editor,
        file: PsiFile,
        timeoutMillis: Int,
    ): List<RequestedAction> {
        val server = LspServerManager.getInstance(file.project)
            .getServersForProvider(PpphpLspServerSupportProvider::class.java)
            .firstOrNull { it.descriptor.isSupportedFile(file.virtualFile) }
            ?: return emptyList()
        val identifier = server.getDocumentIdentifier(file.virtualFile)
        val position = lspPosition(editor.document, editor.caretModel.offset)
        val params = CodeActionParams(
            identifier,
            Range(position, position),
            CodeActionContext(emptyList<Diagnostic>()),
        )
        return try {
            server.sendRequestSync<List<Either<Command, CodeAction>>>(timeoutMillis) { languageServer ->
                languageServer.textDocumentService.codeAction(params)
            }
        } catch (_: Exception) {
            null
        }.orEmpty()
            .filter(Either<Command, CodeAction>::isRight)
            .map(Either<Command, CodeAction>::getRight)
            .filter { action -> action.title.startsWith(ACTION_PREFIX) }
            .map { action -> RequestedAction(identifier.uri, action) }
    }

    private data class RequestedAction(val uri: String, val action: CodeAction)

    private data class ResolvedEdit(val start: Int, val end: Int, val text: String)

    private companion object {
        const val ACTION_PREFIX = "Use import for "
        const val AVAILABILITY_TIMEOUT_MILLISECONDS = 350
        const val INVOCATION_TIMEOUT_MILLISECONDS = 1_500

        fun lspPosition(document: Document, offset: Int): Position {
            val safeOffset = offset.coerceIn(0, document.textLength)
            val line = document.getLineNumber(safeOffset)
            return Position(line, safeOffset - document.getLineStartOffset(line))
        }

        fun resolveEdit(document: Document, edit: TextEdit): ResolvedEdit? {
            val start = documentOffset(document, edit.range.start) ?: return null
            val end = documentOffset(document, edit.range.end) ?: return null
            if (end < start) return null
            return ResolvedEdit(start, end, edit.newText)
        }

        fun documentOffset(document: Document, position: Position): Int? {
            if (position.line !in 0 until document.lineCount) return null
            val start = document.getLineStartOffset(position.line)
            val end = document.getLineEndOffset(position.line)
            return (start + position.character).takeIf { it <= end }
        }
    }
}
