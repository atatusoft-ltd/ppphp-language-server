package com.atatusoft.ppphp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class PpphpImportIntentionTest {
    @Test
    fun `import intention has stable user-facing identity`() {
        val intention = PpphpImportIntention()

        assertEquals("Use import", intention.text)
        assertEquals("++PHP imports", intention.familyName)
        assertFalse(intention.startInWriteAction())
    }
}
