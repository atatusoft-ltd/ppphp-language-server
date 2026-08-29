package com.atatusoft.ppphp

import com.intellij.codeInsight.highlighting.HighlightErrorFilter
import com.intellij.psi.PsiErrorElement

class PpphpSyntaxErrorFilter : HighlightErrorFilter() {
    override fun shouldHighlightErrorElement(element: PsiErrorElement): Boolean {
        val file = element.containingFile
        return file.fileType !== PpphpFileType.INSTANCE &&
            !file.virtualFile.extension.equals("ppp", ignoreCase = true)
    }
}
