package com.atatusoft.ppphp

import com.intellij.testFramework.fixtures.BasePlatformTestCase

class PpphpCommenterTest : BasePlatformTestCase() {
    fun testEnterClosesDocumentationCommentBeforeGenericMethod() {
        myFixture.configureByText(PpphpFileType.INSTANCE, "<?php\nclass Repo<T> {\n    /**<caret>\n    public function add(string \$id, T \$item): void {}\n}")
        myFixture.type('\n')
        myFixture.checkResult("<?php\nclass Repo<T> {\n    /**\n     * <caret>\n     */\n    public function add(string \$id, T \$item): void {}\n}")
    }

    fun testEnterContinuesExistingDocumentationComment() {
        myFixture.configureByText(PpphpFileType.INSTANCE, "<?php\n/**\n * Description<caret>\n */")
        myFixture.type('\n')
        myFixture.checkResult("<?php\n/**\n * Description\n * <caret>\n */")
    }

    fun testExistingCloserIsNotDuplicated() {
        val source = "<?php\n/**<caret> */"
        myFixture.configureByText("native.php", source)
        myFixture.type('\n')
        val nativeResult = myFixture.editor.document.text
        myFixture.configureByText(PpphpFileType.INSTANCE, source)
        myFixture.type('\n')
        assertEquals(nativeResult, myFixture.editor.document.text)
        myFixture.checkResult("<?php\n/**\n * <caret>\n */")
        assertEquals(1, Regex("\\*/").findAll(myFixture.editor.document.text).count())
    }

    fun testCommentLikeTextInStringDoesNotGenerateDocumentation() {
        myFixture.configureByText(PpphpFileType.INSTANCE, "<?php\n\$text = '/**<caret>';")
        myFixture.type('\n')
        assertFalse(myFixture.editor.document.text.contains("*/"))
    }
}
