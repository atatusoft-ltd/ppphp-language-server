package com.atatusoft.ppphp

import com.google.gson.JsonObject
import com.google.gson.JsonParseException
import com.google.gson.JsonParser
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import java.io.IOException

internal object PpphpComposerNamespaceResolver {
    fun resolve(directory: VirtualFile): Resolution {
        val manifest = nearestManifest(directory) ?: return Resolution.NONE
        if (manifest.length > MAX_MANIFEST_BYTES) return Resolution.NONE

        val source = try {
            VfsUtilCore.loadText(manifest)
        } catch (_: IOException) {
            return Resolution.NONE
        }
        val document = parseDocument(source) ?: return Resolution.NONE
        val manifestDirectory = pathSegments(manifest.parent)
        val targetDirectory = pathSegments(directory)

        val preserved = inferResult(
            manifestDirectory,
            targetDirectory,
            mappings(document, PRESERVED_SECTION_PATHS),
        )
        if (preserved.matched) return Resolution(preserved.namespace, authoritative = true)

        val runtime = inferResult(
            manifestDirectory,
            targetDirectory,
            mappings(document, RUNTIME_SECTION_PATHS),
        )
        return if (runtime.matched) {
            Resolution(runtime.namespace, authoritative = true)
        } else {
            Resolution.NONE
        }
    }

    private fun nearestManifest(directory: VirtualFile): VirtualFile? {
        var current: VirtualFile? = directory
        while (current != null) {
            current.findChild(MANIFEST_NAME)?.takeIf { !it.isDirectory }?.let { return it }
            current = current.parent
        }
        return null
    }

    internal fun preservedMappings(source: String): List<AutoloadMapping> =
        parseDocument(source)?.let { mappings(it, PRESERVED_SECTION_PATHS) }.orEmpty()

    internal fun runtimeMappings(source: String): List<AutoloadMapping> =
        parseDocument(source)?.let { mappings(it, RUNTIME_SECTION_PATHS) }.orEmpty()

    internal fun infer(
        manifestDirectory: List<String>,
        targetDirectory: List<String>,
        mappings: List<AutoloadMapping>,
    ): String? = inferResult(manifestDirectory, targetDirectory, mappings).namespace

    private fun inferResult(
        manifestDirectory: List<String>,
        targetDirectory: List<String>,
        mappings: List<AutoloadMapping>,
    ): Inference {
        val matches = mappings.mapNotNull { mapping ->
            val root = resolveMappingPath(manifestDirectory, mapping.path) ?: return@mapNotNull null
            if (!targetDirectory.startsWith(root)) return@mapNotNull null

            val suffix = targetDirectory.drop(root.size)
            if (suffix.any { segment -> !isNamespaceSegment(segment) }) return@mapNotNull null
            Match(mapping.namespace + suffix, root.size)
        }
        if (matches.isEmpty()) return Inference(matched = false, namespace = null)

        val longestPath = matches.maxOf(Match::pathLength)
        val namespaces = matches.asSequence()
            .filter { match -> match.pathLength == longestPath }
            .map { match -> match.namespace.joinToString("\\") }
            .distinct()
            .toList()
        return Inference(matched = true, namespace = namespaces.singleOrNull())
    }

    private fun mappings(
        document: JsonObject,
        sectionPaths: List<List<String>>,
    ): List<AutoloadMapping> = sectionPaths.flatMap { path ->
        readObject(document, path)?.get("psr-4")?.takeIf { it.isJsonObject }
            ?.asJsonObject
            ?.entrySet()
            ?.flatMap { (prefix, value) ->
                val namespace = namespaceSegments(prefix) ?: return@flatMap emptyList()
                readPaths(value)?.map { mappingPath ->
                    AutoloadMapping(namespace, mappingPath)
                }.orEmpty()
            }.orEmpty()
    }

    private fun readObject(document: JsonObject, path: List<String>): JsonObject? {
        var current = document
        for (segment in path) {
            val value = current.get(segment) ?: return null
            if (!value.isJsonObject) return null
            current = value.asJsonObject
        }
        return current
    }

    private fun readPaths(value: com.google.gson.JsonElement): List<String>? = when {
        value.isJsonPrimitive && value.asJsonPrimitive.isString ->
            listOf(value.asString).takeIf { value.asString.isNotEmpty() }

        value.isJsonArray -> value.asJsonArray.map { entry ->
            if (!entry.isJsonPrimitive || !entry.asJsonPrimitive.isString) return null
            entry.asString.takeIf(String::isNotEmpty) ?: return null
        }

        else -> null
    }

    private fun namespaceSegments(prefix: String): List<String>? {
        val normalized = prefix.trim('\\')
        val segments = if (normalized.isEmpty()) emptyList() else normalized.split('\\')
        return segments.takeIf { parts -> parts.all(::isNamespaceSegment) }
    }

    private fun isNamespaceSegment(segment: String): Boolean =
        segment.isNotEmpty() && PpphpPhpNames.isValidNamespace(segment)

    private fun resolveMappingPath(
        manifestDirectory: List<String>,
        configuredPath: String,
    ): List<String>? {
        if ('\u0000' in configuredPath) return null
        val normalized = configuredPath.replace('\\', '/')
        val absolute = normalized.startsWith('/') || WINDOWS_ABSOLUTE_PATH.containsMatchIn(normalized)
        val resolved = if (absolute) mutableListOf() else manifestDirectory.toMutableList()

        for (segment in normalized.split('/')) {
            when (segment) {
                "", "." -> Unit
                ".." -> if (resolved.isEmpty()) return null else resolved.removeAt(resolved.lastIndex)
                else -> resolved.add(segment)
            }
        }
        return resolved
    }

    private fun parseDocument(source: String): JsonObject? = try {
        JsonParser.parseString(source).takeIf { it.isJsonObject }?.asJsonObject
    } catch (_: JsonParseException) {
        null
    }

    private fun pathSegments(file: VirtualFile): List<String> =
        file.path.split('/').filter(String::isNotEmpty)

    private fun List<String>.startsWith(prefix: List<String>): Boolean =
        size >= prefix.size && take(prefix.size) == prefix

    internal data class AutoloadMapping(
        val namespace: List<String>,
        val path: String,
    )

    internal data class Resolution(
        val namespace: String?,
        val authoritative: Boolean,
    ) {
        companion object {
            val NONE = Resolution(namespace = null, authoritative = false)
        }
    }

    private data class Match(val namespace: List<String>, val pathLength: Int)

    private data class Inference(val matched: Boolean, val namespace: String?)

    private const val MANIFEST_NAME = "composer.json"
    private const val MAX_MANIFEST_BYTES = 1024L * 1024L
    private val PRESERVED_SECTION_PATHS = listOf(
        listOf("extra", "ppphp", "source-autoload"),
        listOf("extra", "ppphp", "source-autoload-dev"),
    )
    private val RUNTIME_SECTION_PATHS = listOf(
        listOf("autoload"),
        listOf("autoload-dev"),
    )
    private val WINDOWS_ABSOLUTE_PATH = Regex("^[A-Za-z]:/")
}
