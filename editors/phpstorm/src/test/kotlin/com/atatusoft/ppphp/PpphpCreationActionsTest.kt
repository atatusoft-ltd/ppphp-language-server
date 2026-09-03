package com.atatusoft.ppphp

import com.google.gson.JsonParser
import com.intellij.application.options.CodeStyle
import com.intellij.ide.fileTemplates.FileTemplateManager
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.KeyboardShortcut
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.psi.PsiDirectory
import com.intellij.psi.PsiFile
import com.intellij.psi.PsiManager
import com.intellij.psi.codeStyle.CodeStyleManager
import com.intellij.psi.codeStyle.CommonCodeStyleSettings
import com.intellij.testFramework.TestActionEvent
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextField
import com.intellij.util.PlatformIcons
import com.jetbrains.php.PhpBundle
import com.jetbrains.php.lang.PhpFileType
import com.jetbrains.php.lang.PhpLanguage
import java.awt.event.KeyEvent
import javax.swing.JComboBox

class PpphpCreationActionsTest : BasePlatformTestCase() {
    fun testCreationActionsAreRegistered() {
        val actions = ActionManager.getInstance()

        assertTrue(
            actions.getAction(CREATE_FILE_ACTION_ID) is PpphpCreateFileAction,
        )
        assertTrue(
            actions.getAction(CREATE_CLASS_ACTION_ID) is PpphpCreateClassAction,
        )
    }

    fun testInternalTemplatesUseTheCanonicalExtension() {
        val manager = FileTemplateManager.getInstance(project)

        for (name in TEMPLATE_NAMES) {
            val template = manager.getInternalTemplate(name)
            assertEquals("Template $name must create .ppphp files", "ppphp", template.extension)
        }
    }

    fun testPhpDeclarationKindsBuildNativeInheritanceClauses() {
        val classProperties = specification(
            template = PpphpDeclarationTemplate.CLASS,
            parentClass = "BasePerson",
            relatedTypes = listOf("JsonSerializable", "Stringable"),
        ).templateProperties()
        assertEquals(
            " extends BasePerson implements JsonSerializable, Stringable",
            classProperties["INHERITANCE"],
        )

        val interfaceProperties = specification(
            template = PpphpDeclarationTemplate.INTERFACE,
            relatedTypes = listOf("Countable", "Stringable"),
        ).templateProperties()
        assertEquals(
            " extends Countable, Stringable",
            interfaceProperties["INHERITANCE"],
        )

        val enumProperties = specification(
            template = PpphpDeclarationTemplate.ENUM,
            relatedTypes = listOf("JsonSerializable"),
            backedType = "string",
        ).templateProperties()
        assertEquals(" : string", enumProperties["BACKED_TYPE"])
        assertEquals(" implements JsonSerializable", enumProperties["INHERITANCE"])
        assertFalse(enumProperties.containsKey("TYPE_PARAMETERS"))
    }

    fun testPhpNamesAreValidatedWithPhpStormRules() {
        assertTrue(PpphpPhpNames.isValidTypeName("Person"))
        assertTrue(PpphpPhpNames.isValidQualifiedType("My\\App\\Person"))
        assertTrue(PpphpPhpNames.isValidNamespace("My\\App\\Core"))

        assertFalse(PpphpPhpNames.isValidTypeName("9Person"))
        assertFalse(PpphpPhpNames.isValidTypeName("class"))
        assertFalse(PpphpPhpNames.isValidQualifiedType("My\\9App\\Person"))
        assertFalse(PpphpPhpNames.isValidNamespace("My\\class"))
    }

    fun testNamespaceSuggestionPrioritizesTheEditorNeutralComposerResult() {
        val directory = sourceDirectory("src/Store")

        assertEquals(
            "My\\App\\Store",
            PpphpNamespaceSuggestions.suggest(
                directory,
                PpphpComposerNamespaceResolver.Resolution("My\\App\\Store", true),
            ).first(),
        )
    }

    fun testAuthoritativeAmbiguityDoesNotFallBackToAnEditorGuess() {
        val directory = sourceDirectory("src/Store")

        assertTrue(
            PpphpNamespaceSuggestions.suggest(
                directory,
                PpphpComposerNamespaceResolver.Resolution(null, true),
            ).isEmpty(),
        )
    }

    fun testClassCreationMirrorsPhpAndCreatesAPpphpPsiFile() {
        val directory = sourceDirectory()
        val created = createDeclaration(
            directory,
            specification(
                namespace = "My\\App\\Core",
                parentClass = "BasePerson",
                relatedTypes = listOf("JsonSerializable"),
            ),
        )

        assertEquals("Person.ppphp", created.name)
        assertSame(PpphpFileType.INSTANCE, created.fileType)
        assertTrue(created is PpphpPsiFile)
        assertTrue(created.text.startsWith("<?php"))
        assertTrue(created.text.contains("namespace My\\App\\Core;"))
        assertTrue(
            created.text.contains(
                "class Person extends BasePerson implements JsonSerializable\n{",
            ),
        )
    }

    fun testClassCreationRespectsEndOfLineBraceStyleAndSpacing() {
        val common = CodeStyle.getSettings(project).getCommonSettings(PpphpLanguage.INSTANCE)
        val originalStyle = common.CLASS_BRACE_STYLE
        val originalSpacing = common.SPACE_BEFORE_CLASS_LBRACE
        try {
            common.CLASS_BRACE_STYLE = CommonCodeStyleSettings.END_OF_LINE
            common.SPACE_BEFORE_CLASS_LBRACE = true
            val spaced = createDeclaration(sourceDirectory("spaced"), specification())
            assertTrue(spaced.text.contains("class Person {"))

            common.SPACE_BEFORE_CLASS_LBRACE = false
            val compact = createDeclaration(sourceDirectory("compact"), specification())
            assertTrue(compact.text.contains("class Person{"))
        } finally {
            common.CLASS_BRACE_STYLE = originalStyle
            common.SPACE_BEFORE_CLASS_LBRACE = originalSpacing
        }
    }

    fun testNextLineIfWrappedKeepsAnUnwrappedDeclarationBraceInline() {
        val common = CodeStyle.getSettings(project).getCommonSettings(PpphpLanguage.INSTANCE)
        val originalStyle = common.CLASS_BRACE_STYLE
        val originalSpacing = common.SPACE_BEFORE_CLASS_LBRACE
        try {
            common.CLASS_BRACE_STYLE = CommonCodeStyleSettings.NEXT_LINE_IF_WRAPPED
            common.SPACE_BEFORE_CLASS_LBRACE = true

            assertEquals(
                " {",
                PpphpDeclarationCodeStyle.templateProperties(project)["DECLARATION_LBRACE"],
            )
            assertTrue(
                createDeclaration(
                    sourceDirectory("next-line-if-wrapped"),
                    specification(),
                ).text.contains("class Person {"),
            )
        } finally {
            common.CLASS_BRACE_STYLE = originalStyle
            common.SPACE_BEFORE_CLASS_LBRACE = originalSpacing
        }
    }

    fun testEveryPhpClassBracePlacementIsAppliedLikeTheNativePhpFormatter() {
        val settings = CodeStyle.getSettings(project)
        val ppphp = settings.getCommonSettings(PpphpLanguage.INSTANCE)
        val php = settings.getCommonSettings(PhpLanguage.INSTANCE)
        val originalPpphpStyle = ppphp.CLASS_BRACE_STYLE
        val originalPhpStyle = php.CLASS_BRACE_STYLE
        val originalPpphpSpacing = ppphp.SPACE_BEFORE_CLASS_LBRACE
        val originalPhpSpacing = php.SPACE_BEFORE_CLASS_LBRACE

        try {
            for (style in CLASS_BRACE_STYLES) {
                ppphp.CLASS_BRACE_STYLE = style
                php.CLASS_BRACE_STYLE = style
                ppphp.SPACE_BEFORE_CLASS_LBRACE = true
                php.SPACE_BEFORE_CLASS_LBRACE = true

                val created = createDeclaration(
                    sourceDirectory("brace-style-$style"),
                    specification(),
                )
                val expectedPhp = myFixture.configureByText(
                    "expected-$style.php",
                    "<?php\nclass Person {\n\n}",
                )
                WriteCommandAction.runWriteCommandAction(project) {
                    CodeStyleManager.getInstance(project).reformat(expectedPhp)
                }

                assertEquals(
                    "++PHP creation must follow PHP's class brace style $style",
                    declarationText(expectedPhp.text),
                    declarationText(created.text),
                )
                assertSame(PhpFileType.INSTANCE, expectedPhp.fileType)
            }
        } finally {
            ppphp.CLASS_BRACE_STYLE = originalPpphpStyle
            php.CLASS_BRACE_STYLE = originalPhpStyle
            ppphp.SPACE_BEFORE_CLASS_LBRACE = originalPpphpSpacing
            php.SPACE_BEFORE_CLASS_LBRACE = originalPhpSpacing
        }
    }

    fun testEveryPhpDeclarationTemplateRendersItsDeclarationKind() {
        val declarations = mapOf(
            PpphpDeclarationTemplate.CLASS to "class Person\n{",
            PpphpDeclarationTemplate.INTERFACE to "interface Person\n{",
            PpphpDeclarationTemplate.TRAIT to "trait Person\n{",
            PpphpDeclarationTemplate.ENUM to "enum Person\n{",
        )

        declarations.forEach { (template, expectedDeclaration) ->
            val directory = sourceDirectory(template.displayName.lowercase())
            val created = createDeclaration(directory, specification(template = template))

            assertEquals("Person.ppphp", created.name)
            assertTrue(created.text.contains(expectedDeclaration))
        }
    }

    fun testNameArrowKeysCycleDeclarationTemplatesLikePhp() {
        val nameField = JBTextField()
        val selector = JComboBox(PpphpDeclarationTemplate.entries.toTypedArray())
        val hint = JBLabel()
        val action = PpphpTemplateCycling.install(nameField, selector, hint)
        val expectedTooltip = PhpBundle.message(PpphpTemplateCycling.TOOLTIP_KEY)

        assertSame(PlatformIcons.UP_DOWN_ARROWS, hint.icon)
        assertEquals(expectedTooltip, hint.toolTipText)
        assertEquals(expectedTooltip, hint.accessibleContext.accessibleName)
        assertEquals(
            setOf(KeyEvent.VK_UP, KeyEvent.VK_DOWN),
            action.shortcutSet.shortcuts
                .filterIsInstance<KeyboardShortcut>()
                .map { it.firstKeyStroke.keyCode }
                .toSet(),
        )

        performArrowAction(action, nameField, KeyEvent.VK_DOWN)
        assertEquals(PpphpDeclarationTemplate.INTERFACE, selector.selectedItem)

        performArrowAction(action, nameField, KeyEvent.VK_UP)
        assertEquals(PpphpDeclarationTemplate.CLASS, selector.selectedItem)
    }

    fun testTypeCatalogSeparatesInheritableClassesFromInterfaces() {
        val decoded = PpphpTypeCatalogResolver.decode(
            JsonParser.parseString(
                """{
                    "version": 1,
                    "types": [
                        {"fqn":"Exception","kind":"class","final":false},
                        {"fqn":"Vendor\\Closed","kind":"class","final":true},
                        {"fqn":"JsonSerializable","kind":"interface","final":false},
                        {"fqn":"IgnoredTrait","kind":"trait","final":false}
                    ]
                }""",
            ).asJsonObject,
        )
        val catalog = PpphpKnownTypeCatalog.from(decoded)

        assertEquals(listOf("Exception"), catalog.classes.map(PpphpKnownType::fqn))
        assertEquals(
            listOf("JsonSerializable"),
            catalog.interfaces.map(PpphpKnownType::fqn),
        )
        assertEquals("\\Exception", catalog.classes.single().reference)
    }

    private fun specification(
        template: PpphpDeclarationTemplate = PpphpDeclarationTemplate.CLASS,
        namespace: String = "",
        parentClass: String = "",
        relatedTypes: List<String> = emptyList(),
        backedType: String = "",
    ): PpphpDeclarationSpecification = PpphpDeclarationSpecification(
        typeName = "Person",
        fileBaseName = "Person",
        namespace = namespace,
        template = template,
        parentClass = parentClass,
        relatedTypes = relatedTypes,
        backedType = backedType,
    )

    private fun sourceDirectory(path: String = "src"): PsiDirectory {
        val virtualDirectory = myFixture.tempDirFixture.findOrCreateDir(path)
        return requireNotNull(PsiManager.getInstance(project).findDirectory(virtualDirectory))
    }

    private fun createDeclaration(
        directory: PsiDirectory,
        specification: PpphpDeclarationSpecification,
    ): PsiFile {
        var created: PsiFile? = null
        WriteCommandAction.runWriteCommandAction(project) {
            created = PpphpDeclarationCreator.create(project, directory, specification)
        }
        return requireNotNull(created)
    }

    private fun declarationText(text: String): String =
        text.substring(text.indexOf("class Person")).trim()

    private fun performArrowAction(
        action: com.intellij.openapi.actionSystem.AnAction,
        source: JBTextField,
        keyCode: Int,
    ) {
        val input = KeyEvent(
            source,
            KeyEvent.KEY_PRESSED,
            System.currentTimeMillis(),
            0,
            keyCode,
            KeyEvent.CHAR_UNDEFINED,
        )
        action.actionPerformed(
            TestActionEvent.createTestEvent(action, DataContext.EMPTY_CONTEXT, input),
        )
    }

    private companion object {
        const val CREATE_FILE_ACTION_ID = "com.atatusoft.ppphp.actions.PpphpCreateFileAction"
        const val CREATE_CLASS_ACTION_ID = "com.atatusoft.ppphp.actions.PpphpCreateClassAction"
        val CLASS_BRACE_STYLES = listOf(
            CommonCodeStyleSettings.END_OF_LINE,
            CommonCodeStyleSettings.NEXT_LINE,
            CommonCodeStyleSettings.NEXT_LINE_SHIFTED,
            CommonCodeStyleSettings.NEXT_LINE_SHIFTED2,
        )
        val TEMPLATE_NAMES = listOf(
            "++PHP File",
            "++PHP Class",
            "++PHP Interface",
            "++PHP Trait",
            "++PHP Enum",
        )
    }
}
