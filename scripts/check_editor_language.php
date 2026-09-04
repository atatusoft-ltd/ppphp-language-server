#!/usr/bin/env php
<?php

declare(strict_types=1);

$root = dirname(__DIR__);

$canonicalManifest = load_json($root . '/res/textmate/ppphp/package.json');
$vscodeManifest = load_json($root . '/editors/vscode/package.json');
$grammar = load_json($root . '/res/textmate/ppphp/syntaxes/ppphp.tmLanguage.json');
$recognizedFixture = read_text($root . '/editors/fixtures/recognized-syntax.ppphp');
$rejectedFixture = read_text($root . '/editors/fixtures/rejected-syntax.ppphp');

foreach (
    [
        'canonical TextMate manifest' => $canonicalManifest,
        'VS Code manifest' => $vscodeManifest,
    ] as $label => $manifest
) {
    $extensions = $manifest['contributes']['languages'][0]['extensions'] ?? null;
    require_check(
        $extensions === ['.ppphp'],
        "{$label} must register .ppphp as its only source extension",
    );

    $scopeName = $manifest['contributes']['grammars'][0]['scopeName'] ?? null;
    require_check($scopeName === 'source.ppphp', "{$label} must use source.ppphp");
}

require_check(
    !in_array('ppp', $vscodeManifest['keywords'] ?? [], true),
    'the VS Code manifest must not advertise the retired ppp spelling',
);

require_check(
    ($grammar['scopeName'] ?? null) === 'source.ppphp',
    'the canonical grammar must use source.ppphp',
);

$topLevelIncludes = array_map(
    static fn (mixed $pattern): mixed => is_array($pattern) ? ($pattern['include'] ?? null) : null,
    $grammar['patterns'] ?? [],
);
$typedBindingIndex = array_search('#typed-binding', $topLevelIncludes, true);
$phpFallbackIndex = array_search('source.php', $topLevelIncludes, true);
require_check(
    is_int($typedBindingIndex)
        && is_int($phpFallbackIndex)
        && $typedBindingIndex < $phpFallbackIndex,
    'the canonical grammar must include typed-binding coverage before PHP fallback',
);
require_check(
    isset($grammar['repository']['typed-binding']),
    'the canonical grammar must define typed-binding coverage',
);

$typedBindingPattern = $grammar['repository']['typed-binding']['begin'] ?? null;
require_check(is_string($typedBindingPattern), 'typed-binding must define a begin pattern');
foreach (
    [
        'Person $person = new Person();',
        'readonly string $name = "Andrew";',
        'array<string, Person> $people = [];',
        'string $key => Person $value)',
    ] as $syntax
) {
    require_check(
        preg_match('~' . $typedBindingPattern . '~m', $syntax) === 1,
        "typed-binding grammar does not recognize: {$syntax}",
    );
}
foreach (['val $name = "Andrew";', 'var $attempts = 0;', "<?php\n\$value = 1;"] as $syntax) {
    require_check(
        preg_match('~' . $typedBindingPattern . '~m', $syntax) === 0,
        "typed-binding grammar must reject: {$syntax}",
    );
}

foreach (
    [
        'readonly string $requestedId = $id;',
        'Person $person = new Person($requestedId);',
        '?Person $cached = null;',
        'for (int $index = 0;',
        'array<string, Person> $people =',
        'foreach ($people as string $key => Person $value)',
        'throws StorageFailure',
        'when ($cached !== null)',
    ] as $syntax
) {
    require_check(
        str_contains($recognizedFixture, $syntax),
        "recognized editor fixture is missing: {$syntax}",
    );
}

foreach (['val $name', 'var $attempts'] as $syntax) {
    require_check(
        str_contains($rejectedFixture, $syntax),
        "rejected editor fixture is missing: {$syntax}",
    );
}

$productionRoots = [
    $root . '/README.md',
    $root . '/CHANGELOG.md',
    $root . '/docs',
    $root . '/editors/phpstorm/README.md',
    $root . '/editors/phpstorm/build.gradle.kts',
    $root . '/editors/phpstorm/src/main',
    $root . '/editors/vscode/README.md',
    $root . '/editors/vscode/CHANGELOG.md',
    $root . '/editors/vscode/package.json',
    $root . '/editors/vscode/src',
    $root . '/packages/language-server/package.json',
    $root . '/packages/language-server/src',
    $root . '/res/textmate/ppphp',
];

foreach (text_files($productionRoots) as $path) {
    $text = read_text($path);
    require_check(
        preg_match('/\\.ppp(?!hp)/i', $text) !== 1,
        relative_path($path) . ' still references the retired .ppp extension',
    );
    require_check(
        stripos($text, '.phplus') === false,
        relative_path($path) . ' still references the retired .phplus extension',
    );
}

require_source_contains(
    $root . '/editors/vscode/src/extension.ts',
    'createFileSystemWatcher("**/*.ppphp")',
);
require_source_contains(
    $root . '/packages/language-server/src/node.ts',
    'path.extname(filePath).toLowerCase() !== ".ppphp"',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/resources/META-INF/plugin.xml',
    'extensions="ppphp"',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/resources/META-INF/plugin.xml',
    '<lang.parserDefinition language="++PHP"',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/resources/META-INF/plugin.xml',
    '<lang.formatter',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/resources/META-INF/plugin.xml',
    'implementationClass="com.atatusoft.ppphp.PpphpFormattingModelBuilder"',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/resources/META-INF/plugin.xml',
    'id="com.atatusoft.ppphp.actions.PpphpCreateFileAction"',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/resources/META-INF/plugin.xml',
    'id="com.atatusoft.ppphp.actions.PpphpCreateClassAction"',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/resources/META-INF/plugin.xml',
    'PpphpLanguageCodeStyleSettingsProvider',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/resources/META-INF/plugin.xml',
    '<renameHandler implementation="com.atatusoft.ppphp.PpphpRenameHandler"',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpRenameHandler.kt',
    'PpphpLanguageServerRuntime.createCommandLine(',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpRenameHandler.kt',
    'WriteCommandAction.runWriteCommandAction(',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpCodeStyleSettings.kt',
    'PhpLanguageCodeStyleSettingsProvider',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpFormattingModelBuilder.kt',
    'PpphpElementTypes.INTERPOLATED_STRING',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpLspServerDescriptor.kt',
    '"completion" to mapOf("importSorting" to protocolSorting)',
);
require_check(
    isset($vscodeManifest['contributes']['configuration']['properties']['ppphp.completion.importSorting']),
    'the VS Code manifest must expose deterministic completion import sorting',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/resources/META-INF/plugin.xml',
    '<internalFileTemplate name="++PHP Class" />',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpCreateClassAction.kt',
    'PhpNamespaceCompositeProvider.INSTANCE',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpCreateClassAction.kt',
    'PpphpComposerNamespaceResolver.resolve(project, directory.virtualFile)',
);
require_source_contains(
    $root . '/packages/language-server/src/composer-namespace.ts',
    '["extra", "ppphp", "source-autoload"]',
);
require_source_contains(
    $root . '/packages/language-server/src/composer-namespace.ts',
    '["extra", "ppphp", "source-autoload-dev"]',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpComposerNamespaceResolver.kt',
    '"--infer-composer-namespace"',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpCreateClassAction.kt',
    'removeSuffix(".ppphp")',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpCreateClassAction.kt',
    'PhpNewFileDialog.getCbArrowAction(templateSelector)',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpCreateClassAction.kt',
    'PpphpTemplateCycling.install(typeNameField, templateSelector, templateUpDownHint)',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpCreateClassAction.kt',
    'PlatformIcons.UP_DOWN_ARROWS',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/resources/fileTemplates/internal/++PHP File.ppphp.ft',
    '#parse("PHP File Header.php")',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/resources/fileTemplates/internal/++PHP Class.ppphp.ft',
    'class ${NAME}${INHERITANCE}${DECLARATION_LBRACE}',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpCreateClassAction.kt',
    'CommonCodeStyleSettings.NEXT_LINE_IF_WRAPPED',
);
require_check(
    !str_contains(
        read_text($root . '/editors/phpstorm/src/main/resources/fileTemplates/internal/++PHP Class.ppphp.ft'),
        'TYPE_PARAMETERS',
    ),
    'the class creation template must not emit inactive ++PHP generic syntax',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpLanguage.kt',
    'Language("++PHP")',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpFileType.kt',
    'getDefaultExtension(): String = "ppphp"',
);
require_source_contains(
    $root . '/packages/language-server/src/node.ts',
    'semanticTokensProvider',
);
require_source_contains(
    $root . '/packages/language-server/src/node.ts',
    'renameProvider: { prepareProvider: true }',
);
require_source_contains(
    $root . '/packages/language-server/src/node.ts',
    'codeActionProvider: true',
);
require_source_contains(
    $root . '/packages/language-server/src/type-import.ts',
    'Use import for ${entry.fqn}',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/resources/META-INF/ppphp-lsp.xml',
    'com.atatusoft.ppphp.PpphpImportIntention',
);
require_source_contains(
    $root . '/packages/language-server/src/compiler-rename.ts',
    'result.symbol?.symbolId === target.symbolId',
);
require_source_contains(
    $root . '/packages/language-server/src/semantic-tokens.ts',
    '../../../res/textmate/ppphp/syntaxes/ppphp.tmLanguage.json',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpSyntaxHighlighter.kt',
    'PhpLanguage.INSTANCE',
);
require_source_contains(
    $root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpSyntaxHighlighter.kt',
    'PpphpTokenTypes.unwrap',
);
require_check(
    !str_contains(
        read_text($root . '/editors/phpstorm/src/main/resources/META-INF/plugin.xml'),
        'textmate.bundleProvider',
    ),
    'the PhpStorm adapter must use native PHP lexical highlighting, not a TextMate editor bridge',
);
require_check(
    !str_contains(
        read_text($root . '/editors/phpstorm/build.gradle.kts'),
        'org.jetbrains.plugins.textmate',
    ),
    'the PhpStorm adapter must not carry the obsolete TextMate runtime dependency',
);
require_check(
    !is_file($root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpEditorHighlighterProvider.kt')
        && !is_file($root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpTextMateBundleProvider.kt'),
    'obsolete PhpStorm TextMate bridge sources must stay removed',
);
require_check(
    !is_file($root . '/editors/phpstorm/src/main/kotlin/com/atatusoft/ppphp/PpphpSyntaxClassifier.kt'),
    'the PhpStorm adapter must not duplicate ++PHP syntax classification',
);

fwrite(
    STDOUT,
    "Editor language guard passed: .ppphp is exclusive and shared ++PHP syntax coverage is present.\n",
);

function fail_check(string $message): never
{
    fwrite(STDERR, "editor language check failed: {$message}\n");
    exit(1);
}

function require_check(bool $condition, string $message): void
{
    if (!$condition) {
        fail_check($message);
    }
}

/** @return array<string, mixed> */
function load_json(string $path): array
{
    try {
        $decoded = json_decode(read_text($path), true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException $error) {
        fail_check(relative_path($path) . ' is not valid JSON: ' . $error->getMessage());
    }

    if (!is_array($decoded)) {
        fail_check(relative_path($path) . ' must contain a JSON object');
    }

    return $decoded;
}

function read_text(string $path): string
{
    $text = @file_get_contents($path);
    if ($text === false) {
        fail_check(relative_path($path) . ' could not be read');
    }

    return $text;
}

function relative_path(string $path): string
{
    global $root;

    $prefix = $root . '/';
    return str_starts_with($path, $prefix) ? substr($path, strlen($prefix)) : $path;
}

/**
 * @param list<string> $roots
 * @return list<string>
 */
function text_files(array $roots): array
{
    $files = [];
    $allowedExtensions = ['ft', 'json', 'kt', 'kts', 'md', 'php', 'ts', 'xml'];

    foreach ($roots as $path) {
        if (is_file($path)) {
            $files[] = $path;
            continue;
        }
        if (!is_dir($path)) {
            fail_check(relative_path($path) . ' does not exist');
        }

        $entries = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::LEAVES_ONLY,
        );
        foreach ($entries as $entry) {
            if (
                $entry->isFile()
                && in_array(strtolower($entry->getExtension()), $allowedExtensions, true)
            ) {
                $files[] = $entry->getPathname();
            }
        }
    }

    sort($files);
    return array_values(array_unique($files));
}

function require_source_contains(string $path, string $expected): void
{
    require_check(
        str_contains(read_text($path), $expected),
        relative_path($path) . " must contain {$expected}",
    );
}
