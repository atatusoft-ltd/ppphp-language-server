package com.atatusoft.ppphp

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Test

class PpphpComposerNamespaceResolverTest {
    @Test
    fun decodesTheEditorNeutralResolverResponse() {
        assertEquals(
            PpphpComposerNamespaceResolver.Resolution("My\\App\\Store", true),
            PpphpComposerNamespaceResolver.decode(
                JsonParser.parseString(
                    """{"namespace":"My\\App\\Store","authoritative":true}""",
                ).asJsonObject,
            ),
        )
        assertEquals(
            PpphpComposerNamespaceResolver.Resolution(null, true),
            PpphpComposerNamespaceResolver.decode(
                JsonParser.parseString(
                    """{"namespace":null,"authoritative":true}""",
                ).asJsonObject,
            ),
        )
    }

    @Test
    fun rejectsMalformedResolverResponses() {
        for (source in listOf("{}", "{\"namespace\":null}", "{\"namespace\":false,\"authoritative\":true}")) {
            assertEquals(
                PpphpComposerNamespaceResolver.Resolution.NONE,
                PpphpComposerNamespaceResolver.decode(JsonParser.parseString(source).asJsonObject),
            )
        }
    }
}
