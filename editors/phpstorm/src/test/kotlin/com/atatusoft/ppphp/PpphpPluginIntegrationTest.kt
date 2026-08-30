package com.atatusoft.ppphp

import com.intellij.lang.LanguageParserDefinitions
import com.intellij.openapi.editor.highlighter.EditorHighlighterFactory
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.fileTypes.LanguageFileType
import com.intellij.openapi.fileTypes.SyntaxHighlighter
import com.intellij.openapi.fileTypes.SyntaxHighlighterFactory
import com.intellij.platform.lsp.api.LspServerSupportProvider
import com.intellij.psi.PsiErrorElement
import com.intellij.psi.util.PsiTreeUtil
import com.intellij.testFramework.LightVirtualFile
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.jetbrains.php.lang.PhpLanguage
import com.jetbrains.php.lang.inspections.PhpUndefinedConstantInspection
import java.nio.file.Path
import org.jetbrains.plugins.textmate.TextMateService

class PpphpPluginIntegrationTest : BasePlatformTestCase() {
    fun testPpphpFilesUseTheDistinctPpphpPresentationLanguage() {
        val fileType = FileTypeManager.getInstance().getFileTypeByExtension("ppphp")

        assertSame(PpphpFileType.INSTANCE, fileType)
        assertSame(PpphpLanguage.INSTANCE, (fileType as LanguageFileType).language)
        assertFalse(PpphpLanguage.INSTANCE.isKindOf(PhpLanguage.INSTANCE))
        assertTrue(
            LanguageParserDefinitions.INSTANCE.forLanguage(PpphpLanguage.INSTANCE) is
                PpphpParserDefinition,
        )
        assertNotSame(
            PpphpFileType.INSTANCE,
            FileTypeManager.getInstance().getFileTypeByExtension("ppp"),
        )
    }

    fun testStableLspSupportProviderIsRegistered() {
        val providers = LspServerSupportProvider.EP_NAME.extensionList

        assertEquals(
            1,
            providers.count { provider -> provider is PpphpLspServerSupportProvider },
        )
    }

    fun testLspDescriptorSupportsOnlyPpphpFiles() {
        val descriptor = PpphpLspServerDescriptor(project, Path.of("unused-in-this-test"))

        assertTrue(descriptor.isSupportedFile(LightVirtualFile("example.ppphp")))
        assertFalse(descriptor.isSupportedFile(LightVirtualFile("example.ppp")))
        assertFalse(descriptor.isSupportedFile(LightVirtualFile("example.php")))
        assertFalse(descriptor.isSupportedFile(LightVirtualFile("example.txt")))
    }

    fun testCanonicalTextMateBundleIsRegistered() {
        val descriptor = requireNotNull(
            TextMateService.getInstance().getLanguageDescriptorByFileName("example.ppphp"),
        )

        assertEquals("source.ppphp", descriptor.scopeName.toString())
        assertNull(TextMateService.getInstance().getLanguageDescriptorByFileName("example.ppp"))
    }

    fun testStandardPhpSyntaxFallsBackToTheCanonicalPhpGrammar() {
        val source = "<?php\n\nuse My\\App\\Core\\Person;\n\necho \"Hello World!\\n\";\n"
        val highlighter = ppphpHighlighter(source)

        for (offset in listOf(
            source.indexOf("<?php"),
            source.indexOf("use"),
            source.indexOf("echo"),
            source.indexOf("Person"),
        )) {
            val scope = scopeAt(highlighter, source, offset)
            assertTrue(
                "Expected ordinary PHP syntax to include a PHP grammar scope at $offset; got $scope",
                scope.contains(".php"),
            )
        }
    }

    fun testEditorHighlighterStoresTextMateScopesWithoutDroppingSyntaxColors() {
        val source = "<?php\n\nuse My\\App\\Core\\Person;\n\necho \"Hello World!\\n\";\n"
        val file = myFixture.configureByText(PpphpFileType.INSTANCE, source)
        val highlighter = EditorHighlighterFactory.getInstance()
            .createEditorHighlighter(project, file.virtualFile)

        highlighter.setText(source)
        val iterator = highlighter.createIterator(0)
        var highlightedTokens = 0
        var echoIsHighlighted = false
        val echoOffset = source.indexOf("echo")
        while (!iterator.atEnd()) {
            val keys = iterator.textAttributesKeys
            if (keys.isNotEmpty()) highlightedTokens++
            if (echoOffset in iterator.start until iterator.end) {
                echoIsHighlighted = keys.isNotEmpty()
            }
            iterator.advance()
        }

        assertTrue("Expected styled TextMate tokens", highlightedTokens > 0)
        assertTrue("Expected PHP echo to retain syntax highlighting", echoIsHighlighted)
    }

    fun testRecognizedPpphpSyntaxUsesItsOwnPsiWithoutPhpParserErrors() {
        val source = fixture("recognized-syntax.ppphp")
        val file = myFixture.configureByText(PpphpFileType.INSTANCE, source)

        assertTrue(file is PpphpPsiFile)
        assertNull(PsiTreeUtil.findChildOfType(file, PsiErrorElement::class.java))
    }

    fun testPhpInspectionsDoNotInterpretPpphpExtensionSyntax() {
        myFixture.enableInspections(PhpUndefinedConstantInspection())
        myFixture.configureByText(
            PpphpFileType.INSTANCE,
            """<?php
class Person {}
Person ${'$'}person = new Person();
""",
        )

        assertFalse(
            myFixture.doHighlighting().any { highlight ->
                highlight.description?.contains("Undefined constant") == true
            },
        )
    }

    private fun ppphpHighlighter(source: String): SyntaxHighlighter =
        requireNotNull(
            SyntaxHighlighterFactory.getSyntaxHighlighter(
                PpphpFileType.INSTANCE,
                project,
                LightVirtualFile("example.ppphp", PpphpFileType.INSTANCE, source),
            ),
        )

    private fun fixture(name: String): String =
        requireNotNull(javaClass.classLoader.getResource(name)) {
            "Missing editor fixture $name"
        }.readText()

    private fun scopeAt(
        highlighter: SyntaxHighlighter,
        source: String,
        expectedOffset: Int,
    ): String {
        assertTrue("Expected token offset must exist", expectedOffset >= 0)
        val lexer = highlighter.highlightingLexer
        lexer.start(source)
        while (lexer.tokenType != null) {
            if (expectedOffset in lexer.tokenStart until lexer.tokenEnd) {
                return lexer.tokenType.toString()
            }
            lexer.advance()
        }
        fail("The syntax highlighter did not emit a token at offset $expectedOffset")
        return ""
    }
}
