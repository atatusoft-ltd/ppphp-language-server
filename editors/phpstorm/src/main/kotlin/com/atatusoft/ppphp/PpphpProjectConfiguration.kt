package com.atatusoft.ppphp

import com.google.gson.JsonObject
import com.google.gson.JsonParseException
import com.google.gson.JsonParser
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.vfs.VirtualFile
import java.io.IOException
import java.nio.file.ClosedFileSystemException
import java.nio.file.FileSystemNotFoundException
import java.nio.file.Files
import java.nio.file.InvalidPathException
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.ProviderMismatchException
import java.nio.file.ProviderNotFoundException

internal data class PpphpCompilerOwnedDirectories(
    val output: Path,
    val cache: Path,
) {
    val paths: List<Path> = listOf(output, cache)
}

private data class PpphpProjectRoot(
    val file: VirtualFile,
    val path: Path,
)

internal object PpphpProjectConfiguration {
    const val FILE_NAME = "ppphp.json"
    private const val MAX_CONFIGURATION_BYTES = 1024L * 1024L

    fun configurationPath(project: Project): Path? =
        projectFile(project)?.let(::configurationPath)

    internal fun configurationPath(projectRoot: VirtualFile): Path? = safePathOperation {
        projectRoot(projectRoot)?.path?.resolve(FILE_NAME)
    }

    fun excludedUrls(project: Project): List<String> {
        val projectRoot = projectFile(project) ?: return emptyList()
        return excludedUrls(projectRoot)
    }

    internal fun excludedUrls(projectRoot: VirtualFile): List<String> {
        val root = projectRoot(projectRoot) ?: return emptyList()
        val directories = load(root.path) ?: return emptyList()
        val outputUrl = exclusionUrl(root, directories.output) ?: return emptyList()
        val cacheUrl = exclusionUrl(root, directories.cache) ?: return emptyList()
        val generatedLibrary = outputDirectory(root.file)?.let(PpphpGeneratedPhpLibrary::resolve)

        return if (generatedLibrary == null) {
            listOf(outputUrl, cacheUrl)
        } else {
            generatedLibrary.excludedUrls.sorted() + cacheUrl
        }
    }

    fun load(project: Project): PpphpCompilerOwnedDirectories? {
        val projectRoot = projectFile(project) ?: return null
        return load(projectRoot)
    }

    fun outputDirectory(project: Project): VirtualFile? {
        val projectRoot = projectFile(project) ?: return null
        return outputDirectory(projectRoot)
    }

    internal fun outputDirectory(projectRoot: VirtualFile): VirtualFile? {
        val root = projectRoot(projectRoot) ?: return null
        val output = load(root.path)?.output ?: return null
        val relativePath = safePathOperation {
            FileUtil.toSystemIndependentName(root.path.relativize(output).toString())
        } ?: return null
        return relativePath
            .takeIf(String::isNotEmpty)
            ?.let(root.file::findFileByRelativePath)
            ?.takeIf { file -> file.isValid && file.isDirectory }
    }

    internal fun load(projectRoot: VirtualFile): PpphpCompilerOwnedDirectories? =
        projectRoot(projectRoot)?.let { root -> load(root.path) }

    internal fun load(projectRoot: Path): PpphpCompilerOwnedDirectories? = safePathOperation {
        val root = projectRoot.toRealPath()
        val configuration = root.resolve(FILE_NAME)
        if (!Files.isRegularFile(configuration, LinkOption.NOFOLLOW_LINKS)) {
            return@safePathOperation null
        }

        val size = Files.size(configuration)
        if (size !in 1..MAX_CONFIGURATION_BYTES) return@safePathOperation null

        val document = try {
            Files.newBufferedReader(configuration).use(JsonParser::parseReader)
        } catch (_: JsonParseException) {
            return@safePathOperation null
        }
        if (!document.isJsonObject) return@safePathOperation null

        resolveDirectories(root, configuration, document.asJsonObject)
    }

    private fun projectFile(project: Project): VirtualFile? = safePathOperation {
        project.guessProjectDir()?.takeIf(VirtualFile::isValid)
    }

    private fun projectRoot(file: VirtualFile): PpphpProjectRoot? = safePathOperation {
        file.takeIf(VirtualFile::isValid)
            ?: return@safePathOperation null
        PpphpProjectRoot(file, file.toNioPath().toRealPath())
    }

    private fun exclusionUrl(root: PpphpProjectRoot, path: Path): String? {
        if (!path.startsWith(root.path)) return null
        val relativePath = FileUtil.toSystemIndependentName(root.path.relativize(path).toString())
        if (relativePath.isEmpty()) return null
        return root.file.findFileByRelativePath(relativePath)?.url
            ?: "${root.file.url.trimEnd('/')}/$relativePath"
    }

    private inline fun <T> safePathOperation(operation: () -> T): T? =
        try {
            operation()
        } catch (_: IOException) {
            null
        } catch (_: InvalidPathException) {
            null
        } catch (_: ProviderMismatchException) {
            null
        } catch (_: ClosedFileSystemException) {
            null
        } catch (_: FileSystemNotFoundException) {
            null
        } catch (_: ProviderNotFoundException) {
            null
        } catch (_: UnsupportedOperationException) {
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
        val protectedPaths = (sourcePaths + stubPaths + listOf(configuration)).map { path ->
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
            val pathText = configuredPath.replace('\\', '/')
            val path = root.fileSystem.getPath(pathText)
            (if (path.isAbsolute) path else root.resolve(pathText)).normalize()
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
