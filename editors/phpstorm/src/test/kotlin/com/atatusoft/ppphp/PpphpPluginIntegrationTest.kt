package com.atatusoft.ppphp

import com.intellij.lang.LanguageParserDefinitions
import com.intellij.openapi.editor.highlighter.EditorHighlighter
import com.intellij.openapi.editor.highlighter.EditorHighlighterFactory
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.fileTypes.LanguageFileType
import com.intellij.openapi.fileTypes.SyntaxHighlighter
import com.intellij.openapi.fileTypes.SyntaxHighlighterFactory
import com.intellij.platform.lsp.api.LspServerSupportProvider
import com.intellij.platform.lsp.api.customization.LspSemanticTokensSupport
import com.intellij.psi.PsiErrorElement
import com.intellij.psi.util.PsiTreeUtil
import com.intellij.testFramework.LightVirtualFile
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.jetbrains.php.lang.PhpFileType
import com.jetbrains.php.lang.PhpLanguage
import com.jetbrains.php.lang.highlighter.PhpHighlightingData
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

    fun testLspDescriptorAdvertisesSemanticTokensForPpphpPsi() {
        val descriptor = PpphpLspServerDescriptor(project, Path.of("unused-in-this-test"))
        val support = descriptor.lspCustomization.semanticTokensCustomizer

        assertTrue(support is LspSemanticTokensSupport)
        assertNotNull(descriptor.clientCapabilities.textDocument.semanticTokens)

        val file = myFixture.configureByText(
            PpphpFileType.INSTANCE,
            "<?php\nclass Box<T> { public T \$value; }\n",
        )
        assertTrue((support as LspSemanticTokensSupport).shouldAskServerForSemanticTokens(file))
    }

    fun testSemanticSymbolsUseNativePhpColourSchemeKeys() {
        val support = PpphpSemanticTokensSupport()

        assertSame(
            PhpHighlightingData.FUNCTION,
            support.getTextAttributesKey("method", listOf("declaration")),
        )
        assertSame(
            PhpHighlightingData.INSTANCE_METHOD_CALL,
            support.getTextAttributesKey("method", emptyList()),
        )
        assertSame(
            PhpHighlightingData.INSTANCE_FIELD,
            support.getTextAttributesKey("property", emptyList()),
        )
        assertSame(
            PhpHighlightingData.STATIC_FIELD,
            support.getTextAttributesKey("property", listOf("static")),
        )
        assertSame(
            PhpHighlightingData.CLASS,
            support.getTextAttributesKey("typeParameter", listOf("declaration")),
        )
    }

    fun testEveryPhpLexicalTokenUsesNativePhpHighlighting() {
        assertEquals(
            lexicalStyles(phpHighlighter(PHP_CORPUS), PHP_CORPUS),
            lexicalStyles(ppphpHighlighter(PHP_CORPUS), PHP_CORPUS),
        )
    }

    fun testEditorUsesNativePhpColorsForAllRepresentativePhpKeywords() {
        val ppphpFile = myFixture.configureByText(PpphpFileType.INSTANCE, PHP_CORPUS)
        val phpFile = LightVirtualFile("example.php", PhpFileType.INSTANCE, PHP_CORPUS)
        val factory = EditorHighlighterFactory.getInstance()
        val ppphpEditorHighlighter = factory.createEditorHighlighter(project, ppphpFile.virtualFile)
        val phpEditorHighlighter = factory.createEditorHighlighter(project, phpFile)
        ppphpEditorHighlighter.setText(PHP_CORPUS)
        phpEditorHighlighter.setText(PHP_CORPUS)

        for (lexeme in REPRESENTATIVE_PHP_LEXEMES) {
            val offset = PHP_CORPUS.indexOf(lexeme)
            assertTrue("Missing PHP corpus lexeme: $lexeme", offset >= 0)
            val expected = editorStyleAt(phpEditorHighlighter, offset)
            assertTrue("Native PHP should style $lexeme", expected.isNotEmpty())
            assertEquals(
                "++PHP must use native PHP styling for $lexeme",
                expected,
                editorStyleAt(ppphpEditorHighlighter, offset),
            )
        }
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

    private fun phpHighlighter(source: String): SyntaxHighlighter =
        requireNotNull(
            SyntaxHighlighterFactory.getSyntaxHighlighter(
                PhpFileType.INSTANCE,
                project,
                LightVirtualFile("example.php", PhpFileType.INSTANCE, source),
            ),
        )

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

    private fun lexicalStyles(
        highlighter: SyntaxHighlighter,
        source: String,
    ): List<LexicalStyle> {
        val styles = mutableListOf<LexicalStyle>()
        val lexer = highlighter.highlightingLexer
        lexer.start(source)
        while (lexer.tokenType != null) {
            val tokenType = requireNotNull(lexer.tokenType)
            styles += LexicalStyle(
                lexer.tokenStart,
                lexer.tokenEnd,
                highlighter.getTokenHighlights(tokenType).map { it.externalName },
            )
            lexer.advance()
        }
        return styles
    }

    private fun editorStyleAt(
        highlighter: EditorHighlighter,
        offset: Int,
    ): List<String> {
        val iterator = highlighter.createIterator(offset)
        assertFalse("Expected an editor token at offset $offset", iterator.atEnd())
        assertTrue(offset in iterator.start until iterator.end)
        return iterator.textAttributesKeys.map { it.externalName }
    }

    private data class LexicalStyle(
        val start: Int,
        val end: Int,
        val attributes: List<String>,
    )

    private companion object {
        val REPRESENTATIVE_PHP_LEXEMES = listOf(
            "<?php",
            "declare",
            "namespace",
            "use",
            "final",
            "readonly",
            "class",
            "implements",
            "public",
            "function",
            "private",
            "string",
            "if",
            "throw",
            "new",
            "foreach",
            "as",
            "echo",
            "return",
            "enum",
            "case",
            "match",
            "static",
            "fn",
            "require_once",
        )

        val PHP_CORPUS = """
            <?php
            declare(strict_types=1);

            namespace My\App\Core;

            use Attribute;
            use LogicException;
            use Stringable;

            #[Attribute(Attribute::TARGET_CLASS)]
            final readonly class Person implements Stringable
            {
                public function __construct(
                    private string ${'$'}name = 'Andrew',
                    private ?int ${'$'}age = null,
                ) {}

                public function __toString(): string
                {
                    if (${'$'}this->age === null) {
                        throw new LogicException("Unknown age");
                    }

                    foreach ([1, 2, 3] as ${'$'}number) {
                        echo sprintf('%s:%d', ${'$'}this->name, ${'$'}number);
                    }

                    return ${'$'}this->name;
                }
            }

            enum Status: string
            {
                case Active = 'active';
            }

            ${'$'}label = match (Status::Active) {
                Status::Active => 'ready',
            };
            ${'$'}formatter = static fn (string ${'$'}value): string => strtoupper(${'$'}value);
            require_once __DIR__ . '/bootstrap.php';
        """.trimIndent()
    }
}
