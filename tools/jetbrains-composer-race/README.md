# Native Composer race probe

This diagnostic probe exercises JetBrains' own `ComposerConfigListener`. It does not load ++PHP, open a user's project, edit Composer settings or patch any IDE classes. It uses a synthetic in-memory Composer file and a minimal client. The sequential control calls `inform` and `reset` 10,000 times; the concurrent phase overlaps them for at most five seconds.

This is **not a passing compatibility test**. A successful probe exit means the native defect was reproduced. A run without the exception is inconclusive because scheduling is nondeterministic. Keep it separate from the plugin's release acceptance tests. See the [dated investigation](../../docs/incidents/2026-09-10-diagnostics-and-marketplace.md) for observations and limitations.

Use the unmodified PhpStorm SDK root (the directory containing `lib` and `plugins`) and a JDK able to run that SDK. On macOS, an installed IDE's root is inside its `Contents` directory. Run from the repository root:

```sh
ppphp_probe_dir=$(mktemp -d)
ppphp_sdk=/absolute/path/to/PhpStorm-SDK
ppphp_jdk=/absolute/path/to/JDK
ppphp_classpath="$ppphp_sdk/lib/*:$ppphp_sdk/plugins/php-impl/lib/*:$ppphp_sdk/plugins/php-impl/lib/modules/*"
"$ppphp_jdk/bin/javac" -proc:none -cp "$ppphp_classpath" -d "$ppphp_probe_dir" tools/jetbrains-composer-race/ComposerConfigRace.java
"$ppphp_jdk/bin/java" -cp "$ppphp_probe_dir:$ppphp_classpath" com.jetbrains.php.composer.configData.ComposerConfigRace
```

The commands above are for macOS/Linux. On Windows, use `;` as the Java classpath separator. Keep compiled classes and any captured output in an OS temporary directory. Do not add this probe, its classes or SDK implementation classes to the shipped plugin.
