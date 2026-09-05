package com.atatusoft.ppphp

import com.intellij.application.options.CodeStyle
import com.intellij.application.options.CodeStyleAbstractConfigurable
import com.intellij.application.options.CodeStyleAbstractPanel
import com.intellij.application.options.TabbedLanguageCodeStylePanel
import com.intellij.openapi.editor.Editor
import com.intellij.psi.codeStyle.CodeStyleSettingsCustomizable
import com.intellij.psi.codeStyle.CodeStyleSettingsManager
import com.intellij.psi.codeStyle.CommonCodeStyleSettings
import com.intellij.psi.codeStyle.LanguageCodeStyleSettingsProvider
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.jetbrains.php.lang.PhpLanguage
import com.jetbrains.php.lang.formatter.PhpCodeStyleSettings
import com.jetbrains.php.lang.formatter.ui.PhpLanguageCodeStyleSettingsProvider
import java.lang.reflect.Modifier
import java.lang.reflect.Proxy

class PpphpCodeStyleSettingsTest : BasePlatformTestCase() {
    fun testCodeStyleProviderIsRegisteredForPpphp() {
        val provider = requireNotNull(
            LanguageCodeStyleSettingsProvider.forLanguage(PpphpLanguage.INSTANCE),
        )

        assertTrue(provider is PpphpLanguageCodeStyleSettingsProvider)
        assertEquals("++PHP", provider.languageName)
        assertEquals("ppphp", provider.fileExt)
    }

    fun testFormatterOptionsMatchPhpStormPhpOptions() {
        val ppphpProvider = PpphpLanguageCodeStyleSettingsProvider()
        val phpProvider = PhpLanguageCodeStyleSettingsProvider()

        for (settingsType in LanguageCodeStyleSettingsProvider.SettingsType.entries) {
            assertEquals(
                "++PHP must expose PHP's $settingsType formatter fields",
                phpProvider.getSupportedFields(settingsType),
                ppphpProvider.getSupportedFields(settingsType),
            )
            assertEquals(
                phpProvider.getCodeSample(settingsType),
                ppphpProvider.getCodeSample(settingsType),
            )
        }
    }

    fun testCodeStyleConfigurableBuildsThePhpBackedTabs() {
        val provider = PpphpLanguageCodeStyleSettingsProvider()
        val settings = clonedProjectSettings()
        val configurable = provider.createConfigurable(settings, clonedProjectSettings())

        try {
            assertNotNull(configurable.createComponent())
        } finally {
            configurable.disposeUIResources()
        }
    }

    fun testAllPhpOptionCustomizationsReachThePanels() {
        fun calls(
            provider: LanguageCodeStyleSettingsProvider,
            type: LanguageCodeStyleSettingsProvider.SettingsType,
        ): List<String> {
            val calls = mutableListOf<String>()
            val consumer = Proxy.newProxyInstance(
                CodeStyleSettingsCustomizable::class.java.classLoader,
                arrayOf(CodeStyleSettingsCustomizable::class.java),
            ) { _, method, args ->
                val arguments = (args ?: emptyArray()).contentDeepToString()
                    .replace(PpphpCodeStyleSettings::class.java.name, PhpCodeStyleSettings::class.java.name)
                calls.add(method.name + arguments)
                null
            } as CodeStyleSettingsCustomizable
            provider.customizeSettings(consumer, type)
            return calls
        }
        for (type in LanguageCodeStyleSettingsProvider.SettingsType.entries) {
            assertEquals(
                "Every PHP customization must be forwarded for $type",
                calls(PhpLanguageCodeStyleSettingsProvider(), type),
                calls(PpphpLanguageCodeStyleSettingsProvider(), type),
            )
        }
    }

    fun testEveryPreviewContainsSource() {
        val settings = clonedProjectSettings()
        val configurable = PpphpLanguageCodeStyleSettingsProvider()
            .createConfigurable(settings, clonedProjectSettings()) as CodeStyleAbstractConfigurable
        try {
            configurable.createComponent()
            configurable.reset()
            val tabsField = TabbedLanguageCodeStylePanel::class.java.getDeclaredField("tabs")
                .apply { isAccessible = true }
            val tabs = tabsField.get(configurable.panel) as List<*>
            val update = CodeStyleAbstractPanel::class.java
                .getDeclaredMethod("updatePreview", Boolean::class.javaPrimitiveType)
                .apply { isAccessible = true }
            val getEditor = CodeStyleAbstractPanel::class.java.getDeclaredMethod("getEditor")
                .apply { isAccessible = true }
            var previewCount = 0
            for (tab in tabs) {
                update.invoke(tab, true)
                val editor = getEditor.invoke(tab) as? Editor ?: continue
                previewCount++
                assertTrue("Empty preview in ${tab!!.javaClass.name}", editor.document.text.contains("<?php"))
            }
            assertTrue("The standard formatting tabs must have previews", previewCount >= 4)
        } finally {
            configurable.disposeUIResources()
        }
    }

    fun testDefaultsMatchPhpExceptForCanonicalNextLineClassBraces() {
        val settings = clonedProjectSettings()
        val ppphp = settings.getCommonSettings(PpphpLanguage.INSTANCE)
        val php = requireNotNull(
            LanguageCodeStyleSettingsProvider.getDefaultCommonSettings(PhpLanguage.INSTANCE),
        )

        assertEquals(CommonCodeStyleSettings.NEXT_LINE, ppphp.CLASS_BRACE_STYLE)
        assertEquals(php.METHOD_BRACE_STYLE, ppphp.METHOD_BRACE_STYLE)
        assertEquals(php.BRACE_STYLE, ppphp.BRACE_STYLE)
        assertEquals(php.SPACE_BEFORE_CLASS_LBRACE, ppphp.SPACE_BEFORE_CLASS_LBRACE)
        assertEquals(php.RIGHT_MARGIN, ppphp.RIGHT_MARGIN)
        assertEquals(php.indentOptions?.INDENT_SIZE, ppphp.indentOptions?.INDENT_SIZE)
        assertEquals(
            php.indentOptions?.CONTINUATION_INDENT_SIZE,
            ppphp.indentOptions?.CONTINUATION_INDENT_SIZE,
        )
    }

    fun testPhpSpecificFormatterValuesAreIndependentAndStartAtPhpDefaults() {
        val settings = clonedProjectSettings()
        val php = settings.getCustomSettings(PhpCodeStyleSettings::class.java)
        val ppphp = settings.getCustomSettings(PpphpCodeStyleSettings::class.java)
        val phpFields = PhpCodeStyleSettings::class.java.fields
            .filterNot { Modifier.isStatic(it.modifiers) }
            .associate { it.name to it.type }
        val ppphpFields = PpphpCodeStyleSettings::class.java.fields
            .filterNot { Modifier.isStatic(it.modifiers) }
            .associate { it.name to it.type }

        assertEquals(
            "++PHP must mirror every PHP-specific code-style field",
            phpFields,
            ppphpFields.filterKeys(phpFields::containsKey),
        )
        assertEquals(PHP_2026_FORWARD_FIELDS, ppphpFields.keys - phpFields.keys)
        for (phpField in PhpCodeStyleSettings::class.java.fields) {
            if (Modifier.isStatic(phpField.modifiers)) continue
            val ppphpField = PpphpCodeStyleSettings::class.java.getField(phpField.name)
            assertEquals(
                "Default mismatch for ${ppphpField.name}",
                phpField.get(php),
                ppphpField.get(ppphp),
            )
        }

        val phpConcatSpaces = php.CONCAT_SPACES
        ppphp.CONCAT_SPACES = !phpConcatSpaces
        assertEquals(phpConcatSpaces, php.CONCAT_SPACES)
        assertEquals(!phpConcatSpaces, ppphp.CONCAT_SPACES)
        assertEquals("PpphpCodeStyleSettings", ppphp.tagName)
    }

    private fun clonedProjectSettings() = CodeStyleSettingsManager.getInstance(project)
        .cloneSettings(CodeStyle.getSettings(project))

    companion object {
        private val PHP_2026_FORWARD_FIELDS = setOf(
            "COLLAPSE_ABSTRACT_PROPERTY_HOOKS",
            "COLLAPSE_LINE_BREAK_AFTER_TYPE_CAST",
            "NORMALIZE_CAST_PAREN_SPACING",
            "REFORMAT_NULL_TYPE_POSITION",
            "SPACES_AROUND_AMPERSAND_IN_INTERSECTION_TYPE",
            "SPACES_WITHIN_COMPOUND_TYPE_PARENS",
            "UNION_TYPE_WRAP",
        )
    }
}
