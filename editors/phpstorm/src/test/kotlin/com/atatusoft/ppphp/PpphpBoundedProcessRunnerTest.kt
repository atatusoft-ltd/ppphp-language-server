package com.atatusoft.ppphp

import com.intellij.execution.process.ProcessOutputTypes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PpphpBoundedProcessRunnerTest {
    @Test
    fun `collector stops accepting output at the configured boundary`() {
        var terminations = 0
        val output = PpphpBoundedProcessOutput(8) { terminations += 1 }

        output.append("hello", ProcessOutputTypes.STDOUT)
        output.append("bad", ProcessOutputTypes.STDERR)
        assertFalse(output.limitExceeded)
        assertEquals("hello", output.stdout)
        assertEquals("bad", output.stderr)

        output.append("!", ProcessOutputTypes.STDOUT)
        output.append("ignored", ProcessOutputTypes.STDERR)
        assertTrue(output.limitExceeded)
        assertEquals(1, terminations)
        assertEquals("hello", output.stdout)
        assertEquals("bad", output.stderr)
    }
}
