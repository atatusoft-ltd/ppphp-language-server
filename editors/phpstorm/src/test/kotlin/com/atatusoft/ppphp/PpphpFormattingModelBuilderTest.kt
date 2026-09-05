package com.atatusoft.ppphp

import com.intellij.application.options.CodeStyle
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.psi.codeStyle.CodeStyleManager
import com.intellij.psi.codeStyle.CommonCodeStyleSettings
import com.intellij.psi.codeStyle.LanguageCodeStyleSettingsProvider.SettingsType
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.jetbrains.php.config.PhpLanguageLevel
import com.jetbrains.php.config.PhpProjectSharedConfiguration
import com.jetbrains.php.lang.PhpLanguage
import com.jetbrains.php.lang.formatter.PhpCodeStyleSettings
import com.jetbrains.php.lang.formatter.ui.PhpLanguageCodeStyleSettingsProvider

class PpphpFormattingModelBuilderTest : BasePlatformTestCase() {
    fun testIndentPreviewMatchesPhp() {
        val source = PhpLanguageCodeStyleSettingsProvider().getCodeSample(SettingsType.INDENT_SETTINGS)!!
        assertMatchesPhp(source)
        configureIndent(indentSize = 2, continuationIndentSize = 6, useTabs = false)
        assertMatchesPhp(source)
        configureIndent(indentSize = 4, continuationIndentSize = 4, useTabs = true)
        assertMatchesPhp(source)
    }

    fun testOperatorSettingsMatchPhpForBothValues() {
        val settings = CodeStyle.getSettings(project)
        val common = settings.getCommonSettings(PpphpLanguage.INSTANCE)
        val php = settings.getCustomSettings(PpphpCodeStyleSettings::class.java)
        for (enabled in listOf(false, true)) {
            common.SPACE_AROUND_ASSIGNMENT_OPERATORS = enabled
            common.SPACE_BEFORE_ARRAY_INITIALIZER_LBRACE = enabled
            php.SPACE_AROUND_ASSIGNMENT_IN_DECLARE = !enabled
            php.SPACES_AROUND_ARROW = !enabled
            assertMatchesPhp("<?php\ndeclare(strict_types=1);\n\$a=array(0=>1);\n\$f=fn()=>0;\n\$a->foo();")
            assertMatchesPhp("<?php\n\$a->array(0);\n\$a->declare(\$x=1);")
        }
        assertMatchesPhp("<?php\nA::array(0);")
    }

    fun testMemberSpacingDoesNotSplitNullsafeOperator() {
        val php = CodeStyle.getSettings(project).getCustomSettings(PpphpCodeStyleSettings::class.java)
        for (enabled in listOf(false, true)) {
            php.SPACES_AROUND_ARROW = enabled
            val space = if (enabled) " " else ""
            // The baseline PHP formatter splits ?-> when member-arrow spacing is enabled.
            // Source integrity takes precedence over reproducing that native formatter bug.
            assertFormatted("<?php\n\$a?->foo();", "<?php\n\$a${space}?->${space}foo();")
        }
    }

    fun testClosureInsideCallDoesNotInheritArgumentContinuationIndent() {
        assertMatchesPhp("<?php\nfunction run() {\ncall_func(function() {\nreturn 0;\n});\n}")
    }

    fun testEnterAfterReturnOrAssignmentUsesContinuationIndent() {
        configureIndent(indentSize = 2, continuationIndentSize = 6, useTabs = false)
        for (statement in listOf("return", "\$value =")) {
            val file = myFixture.configureByText(
                PpphpFileType.INSTANCE,
                "<?php\nfunction run()\n{\n  $statement\n\n}\n",
            )
            val offset = file.text.indexOf("\n\n") + 1
            WriteCommandAction.runWriteCommandAction(project) {
                CodeStyleManager.getInstance(project).adjustLineIndent(file, offset)
            }
            assertTrue(myFixture.editor.document.text.contains("$statement\n        \n}"))
        }
    }

    fun testSingleQuotedStringsAreOpaqueIncludingEscapesAndNewlines() {
        for (literal in listOf("'a=b; { text }'", "'it\\'s \\\\ literal'", "'first\nsecond'", "''")) {
            assertFormatted("<?php\n\$value=$literal;", "<?php\n\$value = $literal;")
        }
    }

    fun testReturnContinuationMatchesPhp() = assertMatchesPhp("<?php\nfunction run() {\nreturn\n'value';\n}")

    fun testThrowContinuationMatchesPhp() = assertMatchesPhp("<?php\nfunction run() {\nthrow\nnew Exception();\n}")

    fun testAssignmentContinuationMatchesPhp() = assertMatchesPhp("<?php\nfunction run() {\n\$a =\n1 +\n2;\n}")

    fun testEchoContinuationMatchesPhp() = assertMatchesPhp("<?php\nfunction run() {\necho\n'value';\n}")

    private fun assertMatchesPhp(source: String) {
        project.getService(PhpProjectSharedConfiguration::class.java).state!!.languageLevel = PhpLanguageLevel.PHP840
        val settings = CodeStyle.getSettings(project)
        val common = settings.getCommonSettings(PpphpLanguage.INSTANCE)
        val native = settings.getCommonSettings(PhpLanguage.INSTANCE)
        native.copyFrom(common)
        native.indentOptions!!.copyFrom(settings.getLanguageIndentOptions(PpphpLanguage.INSTANCE))
        PpphpPhpSettingsFields.copy(
            settings.getCustomSettings(PpphpCodeStyleSettings::class.java),
            settings.getCustomSettings(PhpCodeStyleSettings::class.java),
        )
        val file = myFixture.configureByText("reference.php", source)
        WriteCommandAction.runWriteCommandAction(project) { CodeStyleManager.getInstance(project).reformat(file) }
        val expected = myFixture.editor.document.text
        assertFormatted(source, expected)
        assertFormatted(expected, expected)
    }

    fun testIndentSpacingAndBraceSettingsDriveReformatting() {
        val settings = CodeStyle.getSettings(project)
        val common = settings.getCommonSettings(PpphpLanguage.INSTANCE)
        val php = settings.getCustomSettings(PpphpCodeStyleSettings::class.java)
        configureIndent(indentSize = 2, continuationIndentSize = 3, useTabs = false)
        common.CLASS_BRACE_STYLE = CommonCodeStyleSettings.NEXT_LINE
        common.METHOD_BRACE_STYLE = CommonCodeStyleSettings.NEXT_LINE
        common.SPACE_AROUND_ASSIGNMENT_OPERATORS = true
        php.BLANK_LINES_AFTER_OPENING_TAG = 1
        php.SPACE_AFTER_COLON_IN_RETURN_TYPE = true

        assertFormatted(
            "<?php\nclass Service{public function run(string ${'$'}value):void{${'$'}copy=${'$'}value;}}",
            """
            <?php

            class Service
            {
              public function run(string ${'$'}value): void
              {
                ${'$'}copy = ${'$'}value;
              }
            }
            """.trimIndent(),
        )
    }

    fun testPpphpExtensionsRemainIntactAndReceiveStructuralIndentation() {
        CodeStyle.getSettings(project)
            .getCustomSettings(PpphpCodeStyleSettings::class.java)
            .BLANK_LINES_AFTER_OPENING_TAG = 1
        configureIndent(indentSize = 4, continuationIndentSize = 4, useTabs = false)

        assertFormatted(
            """
            <?php
            class Repository<T>{public function find(string ${'$'}id):T throws MissingItem{T ${'$'}item=when(${'$'}id){return load(${'$'}id);}else{return fallback();};return ${'$'}item;}}
            """.trimIndent(),
            """
            <?php

            class Repository<T>
            {
                public function find(string ${'$'}id): T throws MissingItem
                {
                    T ${'$'}item = when (${'$'}id) {
                        return load(${'$'}id);
                    } else {
                        return fallback();
                    };
                    return ${'$'}item;
                }
            }
            """.trimIndent(),
        )
    }

    fun testBlankLineAndImportSettingsDriveReformatting() {
        val settings = CodeStyle.getSettings(project)
        val common = settings.getCommonSettings(PpphpLanguage.INSTANCE)
        val php = settings.getCustomSettings(PpphpCodeStyleSettings::class.java)
        common.BLANK_LINES_BEFORE_PACKAGE = 1
        common.BLANK_LINES_AFTER_PACKAGE = 1
        common.BLANK_LINES_BEFORE_IMPORTS = 0
        common.BLANK_LINES_AFTER_IMPORTS = 2
        php.BLANK_LINES_BETWEEN_IMPORTS = 1

        assertFormatted(
            "<?php namespace App;use App\\Foo;use App\\Bar;class Service{}",
            """
            <?php

            namespace App;

            use App\Foo;

            use App\Bar;


            class Service
            {
            }
            """.trimIndent(),
        )
    }

    fun testStringHeredocAndCommentContentsRemainUntouched() {
        val settings = CodeStyle.getSettings(project)
        val common = settings.getCommonSettings(PpphpLanguage.INSTANCE)
        val php = settings.getCustomSettings(PpphpCodeStyleSettings::class.java)
        configureIndent(indentSize = 4, continuationIndentSize = 4, useTabs = false)
        common.CLASS_BRACE_STYLE = CommonCodeStyleSettings.NEXT_LINE
        common.METHOD_BRACE_STYLE = CommonCodeStyleSettings.NEXT_LINE
        php.SPACE_AFTER_COLON_IN_RETURN_TYPE = true

        val source = """
            <?php
            class Service
            {
                // Keep punctuation such as a=b intact inside strings.
                public function render(): string
                {
                    ${'$'}value = "prefix {${'$'}this->name} a=b suffix";
                    return <<<TEXT
            line {${'$'}this->name} a=b
            TEXT;
                }
            }
        """.trimIndent()

        assertFormatted(source, source)
    }

    fun testBlankLineKeepLimitsAreMaximumsRatherThanMandatoryLines() {
        val settings = CodeStyle.getSettings(project)
        val common = settings.getCommonSettings(PpphpLanguage.INSTANCE)
        val php = settings.getCustomSettings(PpphpCodeStyleSettings::class.java)
        common.CLASS_BRACE_STYLE = CommonCodeStyleSettings.NEXT_LINE
        common.KEEP_BLANK_LINES_BEFORE_RBRACE = 2
        php.KEEP_BLANK_LINES_AFTER_LBRACE = 1

        assertFormatted(
            "<?php\nclass Service\n{\n\n\n\npublic int ${'$'}value;\n\n\n\n}",
            "<?php\nclass Service\n{\n\n    public int ${'$'}value;\n\n\n}",
        )
    }

    fun testDisabledAdditiveSpacingDoesNotMergeBinaryAndUnarySigns() {
        val common = CodeStyle.getSettings(project).getCommonSettings(PpphpLanguage.INSTANCE)
        common.SPACE_AROUND_ADDITIVE_OPERATORS = false
        common.SPACE_AROUND_UNARY_OPERATOR = false

        assertFormatted(
            "<?php\n${'$'}a - -${'$'}b;\n${'$'}a + +${'$'}b;\n${'$'}a + ++${'$'}b;\n${'$'}a-- - ${'$'}b;",
            "<?php\n${'$'}a- -${'$'}b;\n${'$'}a+ +${'$'}b;\n${'$'}a+ ++${'$'}b;\n${'$'}a-- -${'$'}b;",
        )
    }

    fun testDisabledConcatenationSpacingDoesNotMergeNumericLiterals() {
        CodeStyle.getSettings(project)
            .getCustomSettings(PpphpCodeStyleSettings::class.java)
            .CONCAT_SPACES = false

        assertFormatted(
            "<?php\n${'$'}value . 5;\n5 . ${'$'}value;",
            "<?php\n${'$'}value. 5;\n5 .${'$'}value;",
        )
    }

    fun testChildAttributesUseConfiguredTabsForInteractiveIndentation() {
        configureIndent(indentSize = 4, continuationIndentSize = 4, useTabs = true)
        val file = myFixture.configureByText(
            PpphpFileType.INSTANCE,
            "<?php\nclass Service\n{\npublic function run(): void\n{\n\n}\n}\n",
        )
        val offset = file.text.indexOf("\n\n") + 1

        WriteCommandAction.runWriteCommandAction(project) {
            CodeStyleManager.getInstance(project).adjustLineIndent(file, offset)
        }

        val actual = myFixture.editor.document.text
        assertTrue("Expected a two-level tab indent after Enter:\n$actual", actual.contains("{\n\t\t\n}"))
    }

    private fun configureIndent(indentSize: Int, continuationIndentSize: Int, useTabs: Boolean) {
        val options = CodeStyle.getSettings(project)
            .getLanguageIndentOptions(PpphpLanguage.INSTANCE)
        options.INDENT_SIZE = indentSize
        options.CONTINUATION_INDENT_SIZE = continuationIndentSize
        options.TAB_SIZE = indentSize
        options.USE_TAB_CHARACTER = useTabs
    }

    private fun assertFormatted(before: String, expected: String) {
        val file = myFixture.configureByText(PpphpFileType.INSTANCE, before)
        WriteCommandAction.runWriteCommandAction(project) {
            CodeStyleManager.getInstance(project).reformat(file)
        }
        assertEquals(expected, myFixture.editor.document.text)
    }
}
