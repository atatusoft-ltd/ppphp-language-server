package com.atatusoft.ppphp

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.codeInsight.completion.PlainPrefixMatcher
import com.intellij.execution.process.CapturingProcessHandler
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.DumbService
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Computable
import com.jetbrains.php.PhpIndex

internal enum class PpphpKnownTypeKind {
    CLASS,
    INTERFACE,
}

internal data class PpphpKnownType(
    val fqn: String,
    val kind: PpphpKnownTypeKind,
    val isFinal: Boolean = false,
) {
    val shortName: String
        get() = fqn.substringAfterLast('\\')

    val reference: String
        get() = "\\$fqn"
}

internal data class PpphpKnownTypeCatalog(
    val classes: List<PpphpKnownType>,
    val interfaces: List<PpphpKnownType>,
) {
    companion object {
        val EMPTY = PpphpKnownTypeCatalog(emptyList(), emptyList())

        fun from(types: Iterable<PpphpKnownType>): PpphpKnownTypeCatalog {
            val distinct = types
                .filter { PpphpPhpNames.isValidQualifiedType(it.fqn) }
                .associateBy { it.fqn.lowercase() }
                .values
            return PpphpKnownTypeCatalog(
                classes = distinct
                    .filter { it.kind == PpphpKnownTypeKind.CLASS && !it.isFinal }
                    .sortedWith(compareBy(PpphpKnownType::shortName, PpphpKnownType::fqn)),
                interfaces = distinct
                    .filter { it.kind == PpphpKnownTypeKind.INTERFACE }
                    .sortedWith(compareBy(PpphpKnownType::shortName, PpphpKnownType::fqn)),
            )
        }
    }
}

/** Combines the editor-neutral ++PHP catalog with PhpStorm's indexed PHP model. */
internal object PpphpTypeCatalogResolver {
    fun resolve(project: Project): PpphpKnownTypeCatalog = PpphpKnownTypeCatalog.from(
        phpIndexTypes(project) + bundledCatalogTypes(project),
    )

    internal fun decode(response: JsonObject): List<PpphpKnownType> = runCatching {
        if (response.get("version")?.asInt != 1) return@runCatching emptyList()
        val types = response.getAsJsonArray("types") ?: return@runCatching emptyList()
        types.mapNotNull { encoded ->
            val value = encoded.takeIf { it.isJsonObject }?.asJsonObject
                ?: return@mapNotNull null
            val fqn = value.string("fqn")?.trim()?.trimStart('\\')
                ?: return@mapNotNull null
            val kind = when (value.string("kind")) {
                "class" -> PpphpKnownTypeKind.CLASS
                "interface" -> PpphpKnownTypeKind.INTERFACE
                else -> return@mapNotNull null
            }
            val isFinal = value.get("final")
                ?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean }
                ?.asBoolean
                ?: return@mapNotNull null
            PpphpKnownType(fqn, kind, isFinal)
        }
    }.getOrDefault(emptyList())

    private fun bundledCatalogTypes(project: Project): List<PpphpKnownType> {
        val projectRoot = project.basePath ?: return emptyList()
        val pluginRoot = PpphpLanguageServerRuntime.findPluginRoot(javaClass) ?: return emptyList()
        val command = runCatching {
            PpphpLanguageServerRuntime.createCommandLine(
                pluginRoot,
                projectRoot,
                "--type-catalog",
                projectRoot,
            )
        }.getOrNull() ?: return emptyList()
        val output = runCatching {
            CapturingProcessHandler(command).runProcess(REQUEST_TIMEOUT_MILLISECONDS, true)
        }.getOrNull() ?: return emptyList()
        if (
            output.isTimeout || output.exitCode != 0 ||
            output.stdout.length + output.stderr.length > MAXIMUM_OUTPUT_CHARACTERS
        ) {
            return emptyList()
        }
        val response = runCatching { JsonParser.parseString(output.stdout).asJsonObject }.getOrNull()
            ?: return emptyList()
        return decode(response)
    }

    private fun phpIndexTypes(project: Project): List<PpphpKnownType> {
        if (DumbService.isDumb(project)) return emptyList()
        return runCatching {
            ApplicationManager.getApplication().runReadAction(Computable {
                val index = PhpIndex.getInstance(project)
                val matcher = PlainPrefixMatcher("")
                val classes = index.getAllClassFqns(matcher).mapNotNull { fqn ->
                    val declarations = index.getClassesByFQN(fqn)
                        .filter { !it.isInterface && !it.isTrait && !it.isEnum }
                    if (declarations.isEmpty()) null else PpphpKnownType(
                        fqn.trimStart('\\'),
                        PpphpKnownTypeKind.CLASS,
                        declarations.any { it.isFinal },
                    )
                }
                val interfaces = index.getAllInterfacesFqns(matcher).map { fqn ->
                    PpphpKnownType(fqn.trimStart('\\'), PpphpKnownTypeKind.INTERFACE)
                }
                classes + interfaces
            })
        }.getOrDefault(emptyList())
    }

    private fun JsonObject.string(name: String): String? = get(name)
        ?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }
        ?.asString

    private const val REQUEST_TIMEOUT_MILLISECONDS = 30_000
    private const val MAXIMUM_OUTPUT_CHARACTERS = 16 * 1024 * 1024
}
