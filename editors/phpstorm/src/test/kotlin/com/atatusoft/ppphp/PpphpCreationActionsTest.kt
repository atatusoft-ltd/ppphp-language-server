package com.atatusoft.ppphp

import com.intellij.ide.fileTemplates.FileTemplateManager
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.psi.PsiDirectory
import com.intellij.psi.PsiFile
import com.intellij.psi.PsiManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase

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
                "class Person extends BasePerson implements JsonSerializable {",
            ),
        )
    }

    fun testEveryPhpDeclarationTemplateRendersItsDeclarationKind() {
        val declarations = mapOf(
            PpphpDeclarationTemplate.CLASS to "class Person {",
            PpphpDeclarationTemplate.INTERFACE to "interface Person {",
            PpphpDeclarationTemplate.TRAIT to "trait Person {",
            PpphpDeclarationTemplate.ENUM to "enum Person {",
        )

        declarations.forEach { (template, expectedDeclaration) ->
            val directory = sourceDirectory(template.displayName.lowercase())
            val created = createDeclaration(directory, specification(template = template))

            assertEquals("Person.ppphp", created.name)
            assertTrue(created.text.contains(expectedDeclaration))
        }
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

    private companion object {
        const val CREATE_FILE_ACTION_ID = "com.atatusoft.ppphp.actions.PpphpCreateFileAction"
        const val CREATE_CLASS_ACTION_ID = "com.atatusoft.ppphp.actions.PpphpCreateClassAction"
        val TEMPLATE_NAMES = listOf(
            "++PHP File",
            "++PHP Class",
            "++PHP Interface",
            "++PHP Trait",
            "++PHP Enum",
        )
    }
}
