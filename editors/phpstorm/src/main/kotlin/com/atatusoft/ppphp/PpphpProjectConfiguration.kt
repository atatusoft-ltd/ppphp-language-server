package com.atatusoft.ppphp

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.vfs.VfsUtilCore
import java.io.IOException
import java.nio.file.Files
import java.nio.file.InvalidPathException
import java.nio.file.LinkOption
import java.nio.file.Path

internal data class PpphpCompilerOwnedDirectories(
    val output: Path,
    val cache: Path,
) {
    val paths: List<Path> = listOf(output, cache)
}

internal object PpphpProjectConfiguration {
    const val FILE_NAME = "ppphp.json"
    private const val MAX_CONFIGURATION_BYTES = 1024L * 1024L

    fun configurationPath(project: Project): Path? =
        project.basePath?.let { basePath ->
            normalizeProjectRoot(Path.of(basePath))?.resolve(FILE_NAME)
        }

    fun excludedUrls(project: Project): List<String> =
        load(project)?.paths?.map { path ->
            VfsUtilCore.pathToUrl(FileUtil.toSystemIndependentName(path.toString()))
        }.orEmpty()

    fun load(project: Project): PpphpCompilerOwnedDirectories? {
        val basePath = project.basePath ?: return null
        return load(Path.of(basePath))
    }

    internal fun load(projectRoot: Path): PpphpCompilerOwnedDirectories? {
        val root = normalizeProjectRoot(projectRoot) ?: return null
        val configuration = root.resolve(FILE_NAME)
        if (!Files.isRegularFile(configuration, LinkOption.NOFOLLOW_LINKS)) return null

        val size = try {
            Files.size(configuration)
        } catch (_: IOException) {
            return null
        }
        if (size !in 1..MAX_CONFIGURATION_BYTES) return null

        val document = try {
            Files.newBufferedReader(configuration).use(JsonParser::parseReader)
        } catch (_: Exception) {
            return null
        }
        if (!document.isJsonObject) return null

        return resolveDirectories(root, configuration, document.asJsonObject)
    }

    private fun normalizeProjectRoot(projectRoot: Path): Path? =
        try {
            projectRoot.toRealPath()
        } catch (_: IOException) {
            null
        } catch (_: SecurityException) {
            null
        }

    private fun resolveDirectories(
        root: Path,
        configuration: Path,
        document: JsonObject,
    ): PpphpCompilerOwnedDirectories? {
        val source = readPathArray(document, "source", required = true) ?: return null
        val stubs = readPathArray(document, "stubs", required = false) ?: return null
        val output = readPath(document, "output") ?: return null
        val cache = readPath(document, "cache") ?: return null

        val sourcePaths = source.map { resolve(root, it) ?: return null }
        val stubPaths = stubs.map { resolve(root, it) ?: return null }
        val outputPath = resolve(root, output) ?: return null
        val cachePath = resolve(root, cache) ?: return null
        val protectedPaths = (sourcePaths + stubPaths + configuration).map { path ->
            canonicalizeProtectedPath(root, path) ?: return null
        }

        if (!isSafeOwnedDirectory(root, outputPath, protectedPaths)) return null
        if (!isSafeOwnedDirectory(root, cachePath, protectedPaths)) return null
        if (overlaps(outputPath, cachePath)) return null

        return PpphpCompilerOwnedDirectories(outputPath, cachePath)
    }

    private fun readPath(document: JsonObject, property: String): String? {
        val value = document.get(property) ?: return null
        if (!value.isJsonPrimitive || !value.asJsonPrimitive.isString) return null
        return value.asString.takeIf(String::isNotEmpty)
    }

    private fun readPathArray(
        document: JsonObject,
        property: String,
        required: Boolean,
    ): List<String>? {
        val value = document.get(property) ?: return if (required) null else emptyList()
        if (!value.isJsonArray) return null

        val entries = value.asJsonArray.map { entry ->
            if (!entry.isJsonPrimitive || !entry.asJsonPrimitive.isString) return null
            entry.asString.takeIf(String::isNotEmpty) ?: return null
        }
        if (required && entries.isEmpty()) return null
        return entries
    }

    private fun resolve(root: Path, configuredPath: String): Path? =
        try {
            val path = Path.of(configuredPath.replace('\\', '/'))
            (if (path.isAbsolute) path else root.resolve(path)).normalize()
        } catch (_: InvalidPathException) {
            null
        }

    private fun canonicalizeProtectedPath(root: Path, path: Path): Path? {
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) return path

        val canonical = try {
            path.toRealPath()
        } catch (_: IOException) {
            return null
        } catch (_: SecurityException) {
            return null
        }

        return canonical.takeIf { resolved -> resolved.startsWith(root) }
    }

    private fun isSafeOwnedDirectory(
        root: Path,
        ownedDirectory: Path,
        protectedPaths: List<Path>,
    ): Boolean {
        if (ownedDirectory == root || !ownedDirectory.startsWith(root)) return false
        if (protectedPaths.any { protectedPath -> overlaps(ownedDirectory, protectedPath) }) {
            return false
        }

        var current = root
        for (segment in root.relativize(ownedDirectory)) {
            current = current.resolve(segment)
            if (Files.isSymbolicLink(current)) return false
        }
        return true
    }

    private fun overlaps(first: Path, second: Path): Boolean =
        first.startsWith(second) || second.startsWith(first)
}
