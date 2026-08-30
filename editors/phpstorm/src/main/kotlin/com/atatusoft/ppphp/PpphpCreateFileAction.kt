package com.atatusoft.ppphp

import com.intellij.ide.actions.CreateFileFromTemplateAction
import com.intellij.ide.actions.CreateFileFromTemplateDialog
import com.intellij.openapi.project.Project
import com.intellij.psi.PsiDirectory

class PpphpCreateFileAction : CreateFileFromTemplateAction(
    "++PHP File",
    "Create an empty ++PHP source file",
    PpphpIcons.FILE,
) {
    override fun buildDialog(
        project: Project,
        directory: PsiDirectory,
        builder: CreateFileFromTemplateDialog.Builder,
    ) {
        builder
            .setTitle("New ++PHP File")
            .addKind("++PHP File", PpphpIcons.FILE, PPPHP_FILE_TEMPLATE)
    }

    override fun getActionName(
        directory: PsiDirectory,
        newName: String,
        templateName: String,
    ): String = "Create ++PHP file $newName"

    private companion object {
        const val PPPHP_FILE_TEMPLATE = "++PHP File"
    }
}
