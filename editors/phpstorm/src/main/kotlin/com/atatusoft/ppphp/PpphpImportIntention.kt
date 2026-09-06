package com.atatusoft.ppphp

import com.google.gson.Gson
import com.intellij.icons.AllIcons
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.platform.lsp.api.LspServer
import com.intellij.platform.lsp.api.customization.LspCodeActionsSupport
import com.intellij.platform.lsp.api.customization.LspIntentionAction
import com.intellij.psi.PsiFile
import com.intellij.ui.SimpleListCellRenderer
import org.eclipse.lsp4j.CodeAction
import javax.swing.JList

/** Native LSP collection owns availability; no nested request or timeout in isAvailable. */
class PpphpCodeActionsSupport : LspCodeActionsSupport() {
    override fun createIntentionAction(lspServer: LspServer, codeAction: CodeAction): LspIntentionAction =
        PpphpImportIntention(lspServer, codeAction)
}

class PpphpImportIntention(server: LspServer, action: CodeAction) : LspIntentionAction(server, action) {
    private val metadata = Gson().toJsonTree(action.data)?.takeIf { it.isJsonObject }
        ?.asJsonObject?.getAsJsonObject("ppphp")

    override fun isAvailable(project: Project, editor: Editor, psiFile: PsiFile): Boolean =
        super.isAvailable(project, editor, psiFile) && !editor.isViewer &&
            (metadata == null || metadata.get("version")?.asInt == lspServer.getDocumentVersion(editor.document))

    override fun invoke(project: Project, editor: Editor, psiFile: PsiFile) {
        if (!isAvailable(project, editor, psiFile)) return
        when (metadata?.get("kind")?.asString) {
            "importChoices" -> {
                val choices = metadata.getAsJsonArray("choices")
                    .map { Gson().fromJson(it, CodeAction::class.java) }
                JBPopupFactory.getInstance().createPopupChooserBuilder(choices)
                    .setTitle("Class to import")
                    .setRenderer(object : SimpleListCellRenderer<CodeAction>() {
                        override fun customize(list: JList<out CodeAction>, value: CodeAction?, index: Int,
                                               selected: Boolean, hasFocus: Boolean) {
                            text = value?.title?.removePrefix("Import class ").orEmpty()
                            icon = AllIcons.Nodes.Class
                        }
                    })
                    .setItemChosenCallback { choice ->
                        if (isAvailable(project, editor, psiFile)) {
                            LspIntentionAction(lspServer, choice).invoke(project, editor, psiFile)
                        }
                    }
                    .createPopup().showInBestPositionFor(editor)
            }
            "createClass" -> {
                val directory = psiFile.containingDirectory ?: return
                PpphpCreateClassAction().createFromReference(
                    project, directory,
                    metadata.get("name").asString,
                    metadata.get("namespace").asString,
                )
            }
            else -> super.invoke(project, editor, psiFile)
        }
    }
}
