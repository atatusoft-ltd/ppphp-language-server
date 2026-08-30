package com.atatusoft.ppphp

import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.platform.lsp.api.customization.LspSemanticTokensSupport
import com.intellij.psi.PsiFile
import com.jetbrains.php.lang.highlighter.PhpHighlightingData

/**
 * Enables compiler-owned semantic highlighting for ++PHP PSI files and renders
 * standard LSP roles with PhpStorm's native PHP colour-scheme keys.
 */
class PpphpSemanticTokensSupport : LspSemanticTokensSupport() {
    override fun shouldAskServerForSemanticTokens(psiFile: PsiFile): Boolean =
        psiFile.language === PpphpLanguage.INSTANCE

    override fun getTextAttributesKey(
        tokenType: String,
        modifiers: List<String>,
    ): TextAttributesKey? = when (tokenType) {
        "namespace" -> PhpHighlightingData.IDENTIFIER
        "class", "enum", "type", "typeParameter" -> PhpHighlightingData.CLASS
        "interface" -> PhpHighlightingData.INTERFACE
        "parameter" -> PhpHighlightingData.PARAMETER
        "variable" -> PhpHighlightingData.VAR
        "property" -> if ("static" in modifiers) {
            PhpHighlightingData.STATIC_FIELD
        } else {
            PhpHighlightingData.INSTANCE_FIELD
        }
        "enumMember" -> PhpHighlightingData.CONSTANT
        "function" -> if ("declaration" in modifiers) {
            PhpHighlightingData.FUNCTION
        } else {
            PhpHighlightingData.FUNCTION_CALL
        }
        "method" -> when {
            "static" in modifiers -> PhpHighlightingData.STATIC_METHOD_CALL
            "declaration" in modifiers -> PhpHighlightingData.FUNCTION
            else -> PhpHighlightingData.INSTANCE_METHOD_CALL
        }
        "keyword" -> PhpHighlightingData.KEYWORD
        "decorator" -> PhpHighlightingData.ATTRIBUTE
        else -> super.getTextAttributesKey(tokenType, modifiers)
    }
}
