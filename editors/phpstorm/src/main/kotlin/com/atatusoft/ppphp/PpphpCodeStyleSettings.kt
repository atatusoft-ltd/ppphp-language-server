package com.atatusoft.ppphp

import com.intellij.application.options.CodeStyleAbstractConfigurable
import com.intellij.application.options.CodeStyleAbstractPanel
import com.intellij.application.options.IndentOptionsEditor
import com.intellij.application.options.TabbedLanguageCodeStylePanel
import com.intellij.lang.Language
import com.intellij.psi.codeStyle.CodeStyleConfigurable
import com.intellij.psi.codeStyle.CodeStyleSettings
import com.intellij.psi.codeStyle.CodeStyleSettingsCustomizable
import com.intellij.psi.codeStyle.CodeStyleSettingsManager
import com.intellij.psi.codeStyle.CommonCodeStyleSettings
import com.intellij.psi.codeStyle.CustomCodeStyleSettings
import com.intellij.psi.codeStyle.LanguageCodeStyleSettingsProvider
import com.jetbrains.php.lang.PhpLanguage
import com.jetbrains.php.lang.formatter.PhpCodeStyleSettings
import com.jetbrains.php.lang.formatter.ui.PhpConversionCodeStylePanel
import com.jetbrains.php.lang.formatter.ui.PhpDocCodeStylePanel
import com.jetbrains.php.lang.formatter.ui.PhpGenerationCodeStylePanel
import com.jetbrains.php.lang.formatter.ui.PhpLanguageCodeStyleSettingsProvider
import com.jetbrains.php.lang.psi.elements.PhpModifier
import com.jetbrains.php.refactoring.PhpNameStyle
import java.lang.reflect.Modifier

/**
 * Gives ++PHP its own scheme values while reusing PhpStorm's PHP formatter UI contract.
 *
 * PhpStorm's provider exposes PHP-only options against [PhpCodeStyleSettings]. This adapter
 * changes only the settings owner passed to the ++PHP panels; option names, groups, labels,
 * choices, previews, and defaults continue to come from the bundled PHP plugin.
 */
class PpphpLanguageCodeStyleSettingsProvider : LanguageCodeStyleSettingsProvider() {
    private val phpProvider = PhpLanguageCodeStyleSettingsProvider()

    override fun getLanguage(): Language = PpphpLanguage.INSTANCE

    override fun getLanguageName(): String = "++PHP"

    override fun getFileExt(): String = "ppphp"

    override fun getCodeSample(settingsType: SettingsType): String =
        requireNotNull(phpProvider.getCodeSample(settingsType))

    override fun getRightMargin(settingsType: SettingsType): Int =
        phpProvider.getRightMargin(settingsType)

    override fun getIndentOptionsEditor(): IndentOptionsEditor =
        requireNotNull(phpProvider.indentOptionsEditor)

    override fun createCustomSettings(settings: CodeStyleSettings): CustomCodeStyleSettings =
        PpphpCodeStyleSettings(settings)

    override fun customizeDefaults(
        commonSettings: CommonCodeStyleSettings,
        indentOptions: CommonCodeStyleSettings.IndentOptions,
    ) {
        val phpDefaults = requireNotNull(getDefaultCommonSettings(PhpLanguage.INSTANCE))
        commonSettings.copyFrom(phpDefaults)
        phpDefaults.indentOptions?.let(indentOptions::copyFrom)

        // ++PHP's canonical declaration layout starts the class body on the next line.
        commonSettings.CLASS_BRACE_STYLE = CommonCodeStyleSettings.NEXT_LINE
    }

    override fun customizeSettings(
        consumer: CodeStyleSettingsCustomizable,
        settingsType: SettingsType,
    ) {
        phpProvider.customizeSettings(PpphpSettingsCustomizable(consumer), settingsType)
    }

    override fun createConfigurable(
        settings: CodeStyleSettings,
        modelSettings: CodeStyleSettings,
    ): CodeStyleConfigurable = object : CodeStyleAbstractConfigurable(
        settings,
        modelSettings,
        languageName,
    ) {
        override fun createPanel(settings: CodeStyleSettings): CodeStyleAbstractPanel =
            PpphpCodeStyleMainPanel(currentSettings, settings)
    }
}

private class PpphpCodeStyleMainPanel(
    currentSettings: CodeStyleSettings,
    settings: CodeStyleSettings,
) : TabbedLanguageCodeStylePanel(PpphpLanguage.INSTANCE, currentSettings, settings) {
    override fun initTabs(settings: CodeStyleSettings) {
        super.initTabs(settings)
        addTab(PpphpPhpDocCodeStylePanel(settings))
        addTab(PpphpPhpConversionCodeStylePanel(settings))
        addTab(PpphpPhpGenerationCodeStylePanel(settings))
    }
}

/**
 * Independent copies of PhpStorm's PHP-specific code-style fields.
 *
 * Field names and JVM types deliberately match [PhpCodeStyleSettings]. Generic tabs are mapped
 * directly to these fields; PHP's specialized tabs use a private bridge and copy values back.
 */
class PpphpCodeStyleSettings(container: CodeStyleSettings) :
    CustomCodeStyleSettings("PpphpCodeStyleSettings", container) {
    @JvmField var INDENT_CODE_IN_PHP_TAGS = false
    @JvmField var ALIGN_KEY_VALUE_PAIRS = false
    @JvmField var ALIGN_PHPDOC_PARAM_NAMES = false
    @JvmField var ALIGN_PHPDOC_COMMENTS = false
    @JvmField var ALIGN_ASSIGNMENTS = false
    @JvmField var ALIGN_INLINE_COMMENTS = false
    @JvmField var ALIGN_NAMED_ARGUMENTS = false
    @JvmField var ALIGN_MATCH_ARM_BODIES = false
    @JvmField var CONCAT_SPACES = false
    @JvmField var COMMA_AFTER_LAST_ARRAY_ELEMENT = false
    @JvmField var COMMA_AFTER_LAST_PARAMETER = false
    @JvmField var COMMA_AFTER_LAST_PARAMETER_STYLE =
        PhpCodeStyleSettings.PhpAddTrailingCommaStyle.WHEN_MULTILINE
    @JvmField var COMMA_AFTER_LAST_CLOSURE_USE_VAR = false
    @JvmField var COMMA_AFTER_LAST_CLOSURE_USE_VAR_STYLE =
        PhpCodeStyleSettings.PhpAddTrailingCommaStyle.WHEN_MULTILINE
    @JvmField var COMMA_AFTER_LAST_ARGUMENT = false
    @JvmField var COMMA_AFTER_LAST_ARGUMENT_STYLE =
        PhpCodeStyleSettings.PhpAddTrailingCommaStyle.WHEN_MULTILINE
    @JvmField var COMMA_AFTER_LAST_MATCH_ARM = false
    @JvmField var PHPDOC_BLANK_LINE_BEFORE_TAGS = false
    @JvmField var PHPDOC_KEEP_BLANK_LINES = false
    @JvmField var PHPDOC_BLANK_LINES_AROUND_PARAMETERS = false
    @JvmField var PHPDOC_WRAP_LONG_LINES = false
    @JvmField var BLANK_LINES_BETWEEN_IMPORTS = 0
    @JvmField var PHPDOC_PARAM_SPACES_BETWEEN_TAG_AND_TYPE = 0
    @JvmField var PHPDOC_PARAM_SPACES_BETWEEN_TYPE_AND_NAME = 0
    @JvmField var PHPDOC_PARAM_SPACES_BETWEEN_NAME_AND_DESCRIPTION = 0
    @JvmField var ANONYMOUS_BRACE_STYLE = 0
    @JvmField var SORT_PHPDOC_ELEMENTS = false
    @JvmField var LINK_WEIGHT = 0
    @JvmField var THROWS_WEIGHT = 0
    @JvmField var PARAM_WEIGHT = 0
    @JvmField var RETURN_WEIGHT = 0
    @JvmField var AUTHOR_WEIGHT = 0
    @JvmField var INTERNAL_WEIGHT = 0
    @JvmField var USES_WEIGHT = 0
    @JvmField var VERSION_WEIGHT = 0
    @JvmField var API_WEIGHT = 0
    @JvmField var CATEGORY_WEIGHT = 0
    @JvmField var COPYRIGHT_WEIGHT = 0
    @JvmField var DEPRECATED_WEIGHT = 0
    @JvmField var EXAMPLE_WEIGHT = 0
    @JvmField var FILESOURCE_WEIGHT = 0
    @JvmField var GLOBAL_WEIGHT = 0
    @JvmField var IGNORE_WEIGHT = 0
    @JvmField var LICENSE_WEIGHT = 0
    @JvmField var METHOD_WEIGHT = 0
    @JvmField var PACKAGE_WEIGHT = 0
    @JvmField var PROPERTY_WEIGHT = 0
    @JvmField var PROPERTY_READ_WEIGHT = 0
    @JvmField var PROPERTY_WRITE_WEIGHT = 0
    @JvmField var SEE_WEIGHT = 0
    @JvmField var SINCE_WEIGHT = 0
    @JvmField var SUBPACKAGE_WEIGHT = 0
    @JvmField var TODO_WEIGHT = 0
    @JvmField var VAR_WEIGHT = 0
    @JvmField var UNKNOWN_TAG_WEIGHT = 0
    @JvmField var IMPORT_SORTING = PhpCodeStyleSettings.ImportSorting.DONT_SORT
    @JvmField var GROUP_USE_WRAP = 0
    @JvmField var UPPER_CASE_BOOLEAN_CONST = false
    @JvmField var UPPER_CASE_NULL_CONST = false
    @JvmField var LOWER_CASE_BOOLEAN_CONST = false
    @JvmField var LOWER_CASE_NULL_CONST = false
    @JvmField var ELSE_IF_STYLE = PhpCodeStyleSettings.ElseIfStyle.AS_IS
    @JvmField var FIELDS_DEFAULT_VISIBILITY = PhpModifier.Access.PUBLIC
    @JvmField var GETTERS_SETTERS_ORDER_STYLE =
        PhpCodeStyleSettings.GettersSettersOrderStyle.GETTERS_FIRST
    @JvmField var GETTERS_SETTERS_NAMING_STYLE = PhpNameStyle.Style.MIXED
    @JvmField var VARIABLE_NAMING_STYLE = PhpNameStyle.Style.MIXED
    @JvmField var LOWER_CASE_KEYWORDS = false
    @JvmField var BLANK_LINE_BEFORE_RETURN_STATEMENT = false
    @JvmField var COLLAPSE_ABSTRACT_PROPERTY_HOOKS = false
    @JvmField var BLANK_LINES_BEFORE_RETURN_STATEMENT = 0
    @JvmField var KEEP_RPAREN_AND_LBRACE_ON_ONE_LINE = false
    @JvmField var SPACES_AROUND_VAR_WITHIN_BRACKETS = false
    @JvmField var ALIGN_CLASS_CONSTANTS = false
    @JvmField var ALIGN_ENUM_CASES = false
    @JvmField var BLANK_LINES_AROUND_CONSTANTS = 0
    @JvmField var BLANK_LINES_AROUND_ENUM_CASES = 0
    @JvmField var BLANK_LINES_AFTER_OPENING_TAG = 0
    @JvmField var BLANK_LINES_AFTER_FUNCTION = 0
    @JvmField var KEEP_BLANK_LINES_AFTER_LBRACE = 0
    @JvmField var SPACE_BEFORE_UNARY_NOT = false
    @JvmField var SPACE_AFTER_UNARY_NOT = false
    @JvmField var SPACE_BETWEEN_TERNARY_QUEST_AND_COLON = false
    @JvmField var SPACES_WITHIN_SHORT_ECHO_TAGS = false
    @JvmField var SPACE_BEFORE_CLOSURE_LEFT_PARENTHESIS = false
    @JvmField var SPACE_BEFORE_SHORT_CLOSURE_LEFT_PARENTHESIS = false
    @JvmField var COLLAPSE_LINE_BREAK_AFTER_TYPE_CAST = false
    @JvmField var NORMALIZE_CAST_PAREN_SPACING = false
    @JvmField var FORCE_SHORT_DECLARATION_ARRAY_STYLE = false
    @JvmField var NEW_LINE_AFTER_PHP_OPENING_TAG = false
    @JvmField var TREAT_MULTILINE_ARRAYS_AND_LAMBDAS_MULTILINE = false
    @JvmField var SPACES_AROUND_ARROW = false
    @JvmField var SPACES_AROUND_NULL_COALESCE_OPERATOR = false
    @JvmField var SPACE_AROUND_ASSIGNMENT_IN_DECLARE = false
    @JvmField var SPACE_BEFORE_COLON_IN_RETURN_TYPE = false
    @JvmField var SPACE_AFTER_COLON_IN_RETURN_TYPE = false
    @JvmField var SPACE_BEFORE_COLON_IN_NAMED_ARGUMENT = false
    @JvmField var SPACE_AFTER_COLON_IN_NAMED_ARGUMENT = false
    @JvmField var SPACES_AROUND_PIPE_IN_UNION_TYPE = false
    @JvmField var SPACES_AROUND_AMPERSAND_IN_INTERSECTION_TYPE = false
    @JvmField var SPACES_WITHIN_COMPOUND_TYPE_PARENS = false
    @JvmField var RETURN_TYPE_ON_NEW_LINE = false
    @JvmField var SPACE_BEFORE_COLON_IN_ENUM_BACKED_TYPE = false
    @JvmField var SPACE_AFTER_COLON_IN_ENUM_BACKED_TYPE = false
    @JvmField var FORCE_EMPTY_METHODS_IN_ONE_LINE = false
    @JvmField var FORCE_EMPTY_CLASSES_IN_ONE_LINE = false
    @JvmField var PHPDOC_USE_FQCN = false
    @JvmField var NULL_TYPE_POSITION = PhpCodeStyleSettings.PhpDocNullPosition.DONT_FORCE
    @JvmField var REFORMAT_NULL_TYPE_POSITION = PhpCodeStyleSettings.PhpDocNullPosition.DONT_FORCE
    @JvmField var MULTILINE_CHAINED_CALLS_SEMICOLON_ON_NEW_LINE = false
    @JvmField var MULTILINE_CHAINED_CALLS_FIRST_CALL_ON_NEW_LINE = false
    @JvmField var MULTILINE_CLOSURE_LAMBDA_ON_NEW_LINE = false
    @JvmField var HEREDOC_ON_SAME_LINE = false
    @JvmField var PREFER_TEMPLATE_INDENTS = false
    @JvmField var NAMESPACE_BRACE_STYLE = 0
    @JvmField var PLACE_PARENS_FOR_CONSTRUCTOR = 0
    @JvmField var IF_LPAREN_ON_NEXT_LINE = false
    @JvmField var IF_RPAREN_ON_NEXT_LINE = false
    @JvmField var ATTRIBUTES_WRAP = 0
    @JvmField var PARAMETERS_ATTRIBUTES_WRAP = 0
    @JvmField var UNION_TYPE_WRAP = 0

    init {
        PpphpPhpSettingsFields.copy(
            source = PhpCodeStyleSettings(container),
            target = this,
        )
    }
}

private class PpphpSettingsCustomizable(
    private val delegate: CodeStyleSettingsCustomizable,
) : CodeStyleSettingsCustomizable by delegate {
    // Kotlin delegation does not forward these Java default methods (which are no-ops).
    // Preserve PHP's labels and grouping as well as its list of supported fields.
    override fun renameStandardOption(fieldName: String, newTitle: String) {
        delegate.renameStandardOption(fieldName, newTitle)
    }

    override fun moveStandardOption(fieldName: String, newGroup: String) {
        delegate.moveStandardOption(fieldName, newGroup)
    }

    override fun showCustomOption(
        settingsClass: Class<out CustomCodeStyleSettings>,
        fieldName: String,
        title: String,
        groupName: String?,
        vararg options: Any,
    ) {
        mappedSettingsClass(settingsClass, fieldName)?.let { mappedClass ->
            delegate.showCustomOption(mappedClass, fieldName, title, groupName, *options)
        }
    }

    override fun showCustomOption(
        settingsClass: Class<out CustomCodeStyleSettings>,
        fieldName: String,
        title: String,
        groupName: String?,
        anchor: CodeStyleSettingsCustomizable.OptionAnchor?,
        anchorFieldName: String?,
        vararg options: Any,
    ) {
        mappedSettingsClass(settingsClass, fieldName)?.let { mappedClass ->
            delegate.showCustomOption(
                mappedClass,
                fieldName,
                title,
                groupName,
                anchor,
                anchorFieldName,
                *options,
            )
        }
    }

    private fun mappedSettingsClass(
        settingsClass: Class<out CustomCodeStyleSettings>,
        fieldName: String,
    ): Class<out CustomCodeStyleSettings>? {
        if (settingsClass != PhpCodeStyleSettings::class.java) return settingsClass
        return if (PpphpPhpSettingsFields.hasPpphpField(fieldName)) {
            PpphpCodeStyleSettings::class.java
        } else {
            // A newer PhpStorm may add an option before ++PHP's compatibility baseline moves.
            // Hiding that one option is safer than accidentally editing ordinary PHP settings.
            null
        }
    }
}

private class PpphpPhpDocCodeStylePanel(
    settings: CodeStyleSettings,
    private val bridgeSettings: CodeStyleSettings = PpphpPhpPanelSettings.create(settings),
) : PhpDocCodeStylePanel(bridgeSettings) {
    override fun apply(settings: CodeStyleSettings) {
        super.apply(bridgeSettings)
        PpphpPhpPanelSettings.apply(bridgeSettings, settings)
    }

    override fun isModified(settings: CodeStyleSettings): Boolean {
        return super.isModified(PpphpPhpPanelSettings.create(settings))
    }

    override fun resetImpl(settings: CodeStyleSettings) {
        PpphpPhpPanelSettings.refresh(settings, bridgeSettings)
        super.resetImpl(bridgeSettings)
    }
}

private class PpphpPhpConversionCodeStylePanel(
    settings: CodeStyleSettings,
    private val bridgeSettings: CodeStyleSettings = PpphpPhpPanelSettings.create(settings),
) : PhpConversionCodeStylePanel(bridgeSettings) {
    override fun apply(settings: CodeStyleSettings) {
        super.apply(bridgeSettings)
        PpphpPhpPanelSettings.apply(bridgeSettings, settings)
    }

    override fun isModified(settings: CodeStyleSettings): Boolean {
        return super.isModified(PpphpPhpPanelSettings.create(settings))
    }

    override fun resetImpl(settings: CodeStyleSettings) {
        PpphpPhpPanelSettings.refresh(settings, bridgeSettings)
        super.resetImpl(bridgeSettings)
    }
}

private class PpphpPhpGenerationCodeStylePanel(
    settings: CodeStyleSettings,
    private val bridgeSettings: CodeStyleSettings = PpphpPhpPanelSettings.create(settings),
) : PhpGenerationCodeStylePanel(bridgeSettings) {
    override fun apply(settings: CodeStyleSettings) {
        super.apply(bridgeSettings)
        PpphpPhpPanelSettings.apply(bridgeSettings, settings)
    }

    override fun isModified(settings: CodeStyleSettings): Boolean {
        return super.isModified(PpphpPhpPanelSettings.create(settings))
    }

    override fun resetImpl(settings: CodeStyleSettings) {
        PpphpPhpPanelSettings.refresh(settings, bridgeSettings)
        super.resetImpl(bridgeSettings)
    }
}

private object PpphpPhpPanelSettings {
    fun create(settings: CodeStyleSettings): CodeStyleSettings =
        CodeStyleSettingsManager.getInstance().cloneSettings(settings).also { bridge ->
        refresh(settings, bridge)
    }

    fun refresh(source: CodeStyleSettings, bridge: CodeStyleSettings) {
        PpphpPhpSettingsFields.copy(
            source = source.getCustomSettings(PpphpCodeStyleSettings::class.java),
            target = bridge.getCustomSettings(PhpCodeStyleSettings::class.java),
        )
    }

    fun apply(bridge: CodeStyleSettings, target: CodeStyleSettings) {
        PpphpPhpSettingsFields.copy(
            source = bridge.getCustomSettings(PhpCodeStyleSettings::class.java),
            target = target.getCustomSettings(PpphpCodeStyleSettings::class.java),
        )
    }
}

internal object PpphpPhpSettingsFields {
    private val ppphpFields = PpphpCodeStyleSettings::class.java.fields
        .filterNot { Modifier.isStatic(it.modifiers) }
        .associateBy { it.name }

    fun hasPpphpField(name: String): Boolean = ppphpFields.containsKey(name)

    fun copy(source: PhpCodeStyleSettings, target: PpphpCodeStyleSettings) {
        copyPublicFields(source, target)
    }

    fun copy(source: PpphpCodeStyleSettings, target: PhpCodeStyleSettings) {
        copyPublicFields(source, target)
    }

    private fun copyPublicFields(source: Any, target: Any) {
        for ((name, ppphpField) in ppphpFields) {
            val sourceField = runCatching { source.javaClass.getField(name) }.getOrNull()
                ?: continue
            val targetField = runCatching { target.javaClass.getField(name) }.getOrNull()
                ?: continue
            check(ppphpField.type == sourceField.type && sourceField.type == targetField.type) {
                "++PHP code-style field $name no longer matches PhpStorm's PHP field type"
            }
            targetField.set(target, sourceField.get(source))
        }
    }
}
