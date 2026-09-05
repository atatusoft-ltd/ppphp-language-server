package com.atatusoft.ppphp

import com.intellij.codeInsight.editorActions.enter.EnterHandlerDelegateAdapter
import com.intellij.codeInsight.editorActions.enter.EnterHandlerDelegate.Result
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.editor.Editor
import com.intellij.psi.PsiComment
import com.intellij.psi.PsiDocumentManager
import com.intellij.psi.PsiFile

/** Finish the platform's star continuation when an existing closer is on the caret line. */
class PpphpDocumentationEnterHandler : EnterHandlerDelegateAdapter() {
    override fun postProcessEnter(file: PsiFile, editor: Editor, dataContext: DataContext): Result {
        if (file.language != PpphpLanguage.INSTANCE) return Result.Continue
        val document = editor.document
        val offset = editor.caretModel.offset
        val line = document.getLineNumber(offset)
        val start = document.getLineStartOffset(line)
        val end = document.getLineEndOffset(line)
        val before = document.charsSequence.subSequence(start, offset).toString()
        val after = document.charsSequence.subSequence(offset, end).toString()
        if (before.trim() != "*" || after.trim() != "*/") return Result.Continue
        PsiDocumentManager.getInstance(file.project).commitDocument(document)
        val comment = file.findElementAt(offset) as? PsiComment ?: return Result.Continue
        if (!PpphpCommenter().isDocumentationComment(comment)) return Result.Continue
        val indent = before.takeWhile { it == ' ' || it == '\t' }
        document.replaceString(offset, end, "\n${indent}*/")
        editor.caretModel.moveToOffset(offset)
        return Result.Continue
    }
}
