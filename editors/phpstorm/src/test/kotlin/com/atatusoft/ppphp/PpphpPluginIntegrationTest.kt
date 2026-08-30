package com.atatusoft.ppphp

import com.intellij.lang.LanguageParserDefinitions
import com.intellij.openapi.editor.colors.TextAttributesKey
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

    fun testStandardPhpTokensRetainNativePhpHighlighting() {
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
        val ppphpHighlighter = ppphpHighlighter(source)

        for (token in listOf("<?php", "use", "echo", "Person")) {
            assertEquals(
                "Expected .ppphp token '$token' to retain PHP's native attributes",
                attributesFor(phpHighlighter, source, token).toList(),
                attributesFor(ppphpHighlighter, source, token).toList(),
            )
        }
    }

    fun testRecognizedPpphpSyntaxUsesItsOwnPsiAndHighlighting() {
        val source = fixture("recognized-syntax.ppphp")
        val file = myFixture.configureByText(PpphpFileType.INSTANCE, source)

        assertTrue(file is PpphpPsiFile)
        assertNull(PsiTreeUtil.findChildOfType(file, PsiErrorElement::class.java))

        val highlighter = ppphpHighlighter(source)
        for (offset in listOf(
            source.indexOf("Person ${'$'}person"),
            source.indexOf("Person ${'$'}cached"),
            source.indexOf("int ${'$'}index"),
            source.indexOf("string ${'$'}key"),
            source.indexOf("Person ${'$'}value"),
            source.indexOf(
                "StorageFailure",
                source.indexOf("throws"),
            ),
        )) {
            assertContainsElements(
                attributesAt(highlighter, source, offset).map { it.externalName },
                "PPPHP_TYPE_NAME",
            )
        }

        for (keyword in listOf("readonly", "throws", "when")) {
            assertContainsElements(
                attributesFor(highlighter, source, keyword).map { it.externalName },
                "PPPHP_CONTEXTUAL_KEYWORD",
            )
        }
    }

    fun testRejectedInferredDeclarationSpellingsAreNotPresentedAsPpphpSyntax() {
        val source = fixture("rejected-syntax.ppphp")
        val highlighter = ppphpHighlighter(source)

        for (word in listOf("val", "var")) {
            val attributes = attributesFor(highlighter, source, word).map { it.externalName }
            assertFalse(attributes.contains("PPPHP_CONTEXTUAL_KEYWORD"))
            assertFalse(attributes.contains("PPPHP_TYPE_NAME"))
        }
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

    private fun attributesAt(
        highlighter: SyntaxHighlighter,
        source: String,
        expectedOffset: Int,
    ): Array<TextAttributesKey> {
        assertTrue("Expected token offset must exist", expectedOffset >= 0)
        val lexer = highlighter.highlightingLexer
        lexer.start(source)
        while (lexer.tokenType != null) {
            if (expectedOffset in lexer.tokenStart until lexer.tokenEnd) {
                return highlighter.getTokenHighlights(lexer.tokenType!!)
            }
            lexer.advance()
        }
        fail("The syntax highlighter did not emit a token at offset $expectedOffset")
        return emptyArray()
    }
}
