package com.atatusoft.ppphp

import com.intellij.application.options.CodeStyle
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.psi.codeStyle.CodeStyleManager
import com.intellij.psi.codeStyle.CommonCodeStyleSettings
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class PpphpFormattingModelBuilderTest : BasePlatformTestCase() {
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
