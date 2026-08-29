package com.atatusoft.ppphp

import com.intellij.lang.LanguageParserDefinitions
import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.fileTypes.LanguageFileType
import com.intellij.openapi.fileTypes.SyntaxHighlighter
import com.intellij.openapi.fileTypes.SyntaxHighlighterFactory
import com.intellij.psi.PsiErrorElement
import com.intellij.psi.util.PsiTreeUtil
import com.intellij.testFramework.LightVirtualFile
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.jetbrains.php.lang.PhpLanguage

class PpphpPluginIntegrationTest : BasePlatformTestCase() {
    fun testPppFilesUseThePhpLanguageDialect() {
        val fileType = FileTypeManager.getInstance().getFileTypeByExtension("ppp")

        assertSame(PpphpFileType.INSTANCE, fileType)
        assertSame(PpphpLanguage.INSTANCE, (fileType as LanguageFileType).language)
        assertTrue(PpphpLanguage.INSTANCE.isKindOf(PhpLanguage.INSTANCE))
        assertNotNull(LanguageParserDefinitions.INSTANCE.forLanguage(PpphpLanguage.INSTANCE))
    }

    fun testStandardPhpTokensUseNativePhpHighlighting() {
        val source = "<?php\n\nuse My\\App\\Core\\Person;\n\necho \"Hello World!\\n\";\n"
        val phpFileType = FileTypeManager.getInstance().getFileTypeByExtension("php")
        val phpHighlighter =
            requireNotNull(
                SyntaxHighlighterFactory.getSyntaxHighlighter(
                    phpFileType,
                    project,
                    LightVirtualFile("example.php", phpFileType, source),
                ),
            )
        val ppphpHighlighter =
            requireNotNull(
                SyntaxHighlighterFactory.getSyntaxHighlighter(
                    PpphpFileType.INSTANCE,
                    project,
                    LightVirtualFile("example.ppp", PpphpFileType.INSTANCE, source),
                ),
            )

        for (token in listOf("<?php", "use", "echo", "Person")) {
            assertEquals(
                "Expected .ppp token '$token' to use PHP's native attributes",
                attributesFor(phpHighlighter, source, token).toList(),
                attributesFor(ppphpHighlighter, source, token).toList(),
            )
        }
    }

    fun testPpphpContextualKeywordsAreHighlighted() {
        val source = "<?php\nwhen (true) {}\nfunction run() throws Error {}\n"
        val highlighter =
            requireNotNull(
                SyntaxHighlighterFactory.getSyntaxHighlighter(
                    PpphpFileType.INSTANCE,
                    project,
                    LightVirtualFile("example.ppp", PpphpFileType.INSTANCE, source),
                ),
            )

        for (keyword in listOf("when", "throws")) {
            assertContainsElements(
                attributesFor(highlighter, source, keyword).map { it.externalName },
                "PPPHP_CONTEXTUAL_KEYWORD",
            )
        }
    }

    fun testPhpParserErrorsAreNotPresentedAsPpphpDiagnostics() {
        val file =
            myFixture.configureByText(
                PpphpFileType.INSTANCE,
                "<?php\nfunction run() throws Error {}\n",
            )
        val parserError = PsiTreeUtil.findChildOfType(file, PsiErrorElement::class.java)

        assertNotNull("The PHP parser should reject ++PHP's throws clause", parserError)
        assertFalse(PpphpSyntaxErrorFilter().shouldHighlightErrorElement(parserError!!))
    }

    private fun attributesFor(
        highlighter: SyntaxHighlighter,
        source: String,
        expectedToken: String,
    ): Array<TextAttributesKey> {
        val lexer = highlighter.highlightingLexer
        lexer.start(source)
        while (lexer.tokenType != null) {
            if (lexer.tokenText == expectedToken) {
                return highlighter.getTokenHighlights(lexer.tokenType!!)
            }
            lexer.advance()
        }
        fail("The syntax highlighter did not emit token '$expectedToken'")
        return emptyArray()
    }
}
