package com.atatusoft.ppphp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PpphpComposerNamespaceResolverTest {
    @Test
    fun infersProductionAndDevelopmentSourceNamespacesFromEveryPsr4PathForm() {
        val mappings = preservedMappings(
            """
            {
              "extra": {
                "ppphp": {
                  "source-autoload": {
                    "psr-4": {
                      "My\\App\\": ["src/", "legacy/"]
                    }
                  },
                  "source-autoload-dev": {
                    "psr-4": {
                      "My\\App\\Tests\\": "tests/"
                    }
                  }
                }
              }
            }
            """.trimIndent(),
        )

        assertEquals("My\\App\\Store", infer(listOf("project", "src", "Store"), mappings))
        assertEquals("My\\App\\Legacy", infer(listOf("project", "legacy", "Legacy"), mappings))
        assertEquals("My\\App\\Tests\\Unit", infer(listOf("project", "tests", "Unit"), mappings))
    }

    @Test
    fun givesTheMostSpecificSourceRootAuthority() {
        val mappings = preservedMappings(
            """
            {
              "extra": {
                "ppphp": {
                  "source-autoload": {
                    "psr-4": {
                      "My\\App\\": "src/",
                      "My\\App\\Generated\\": "src/Generated/"
                    }
                  }
                }
              }
            }
            """.trimIndent(),
        )

        assertEquals(
            "My\\App\\Generated\\Api",
            infer(listOf("project", "src", "Generated", "Api"), mappings),
        )
    }

    @Test
    fun declinesAmbiguousEqualRootsInsteadOfGuessing() {
        val mappings = preservedMappings(
            """
            {
              "extra": {
                "ppphp": {
                  "source-autoload": {"psr-4": {"My\\App\\": "src/"}},
                  "source-autoload-dev": {"psr-4": {"My\\Tests\\": "src/"}}
                }
              }
            }
            """.trimIndent(),
        )

        assertNull(infer(listOf("project", "src", "Store"), mappings))
    }

    @Test
    fun understandsNormalizedAndParentRelativeComposerPaths() {
        val mappings = preservedMappings(
            """
            {
              "extra": {
                "ppphp": {
                  "source-autoload": {
                    "psr-4": {"Shared\\": "../shared/./src/"}
                  }
                }
              }
            }
            """.trimIndent(),
        )

        assertEquals(
            "Shared\\Model",
            PpphpComposerNamespaceResolver.infer(
                listOf("workspace", "package"),
                listOf("workspace", "shared", "src", "Model"),
                mappings,
            ),
        )
    }

    @Test
    fun readsOrdinaryComposerMappingsBeforeRuntimeProjection() {
        val mappings = PpphpComposerNamespaceResolver.runtimeMappings(
            """
            {
              "autoload": {"psr-4": {"My\\App\\": "src/"}},
              "autoload-dev": {"psr-4": {"My\\App\\Tests\\": ["tests/"]}}
            }
            """.trimIndent(),
        )

        assertEquals("My\\App\\Store", infer(listOf("project", "src", "Store"), mappings))
        assertEquals("My\\App\\Tests\\Unit", infer(listOf("project", "tests", "Unit"), mappings))
    }

    @Test
    fun ignoresInvalidComposerMetadataAndInvalidNamespaceSuffixes() {
        assertEquals(
            emptyList<PpphpComposerNamespaceResolver.AutoloadMapping>(),
            preservedMappings("not json"),
        )
        val mappings = preservedMappings(
            """
            {
              "extra": {
                "ppphp": {
                  "source-autoload": {"psr-4": {"My\\App\\": "src/"}}
                }
              }
            }
            """.trimIndent(),
        )
        assertNull(infer(listOf("project", "src", "invalid-name"), mappings))
    }

    private fun preservedMappings(source: String) =
        PpphpComposerNamespaceResolver.preservedMappings(source)

    private fun infer(
        target: List<String>,
        mappings: List<PpphpComposerNamespaceResolver.AutoloadMapping>,
    ): String? = PpphpComposerNamespaceResolver.infer(listOf("project"), target, mappings)
}
