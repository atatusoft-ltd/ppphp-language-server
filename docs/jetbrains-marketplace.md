# JetBrains Marketplace listing

This is the maintainer handoff for the JetBrains listing, not user-facing description text. Follow [JetBrains' listing guidance](https://plugins.jetbrains.com/docs/marketplace/best-practices-for-listing.html). A repository README is not the Marketplace page: the page combines package metadata, HTML description, separately managed media, and contact fields.

## Listing fields

| Field         | Source or value                                                                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name          | `++PHP`, from `plugin.xml` and the Gradle plugin configuration. No IDE suffix, release label, or added “Plugin”/“Support”.                                                                |
| Overview      | The HTML `description` in `editors/phpstorm/src/main/resources/META-INF/plugin.xml`. Keep the package as the source of truth rather than maintaining a divergent admin-panel description. |
| Website       | `https://ppphplang.org`, declared on the `idea-plugin` element.                                                                                                                           |
| Category      | Programming Language. Select in the Marketplace upload form.                                                                                                                              |
| Documentation | [User guide](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/docs/phpstorm.md).                                                                                          |
| Issue tracker | [Repository issues](https://github.com/atatusoft-ltd/ppphp-language-server/issues).                                                                                                       |
| Source        | [Repository](https://github.com/atatusoft-ltd/ppphp-language-server).                                                                                                                     |
| License       | [Repository license](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/LICENSE).                                                                                           |
| Compatibility | Actual plugin dependencies, build constraints, and verified IDEs. Do not infer support for other JetBrains products from the platform-neutral name.                                       |

The repository README keeps its requested badges as repository navigation. Do not paste the badges or the entire installation manual into the Marketplace description. The short overview and feature list are followed by getting-started guidance and direct documentation/support links, which also work inside the IDE's Plugin Manager.

## Media checklist — required before publishing

The gallery is managed in the Marketplace **Media** section, not by the README or `plugin.xml`. These maintainer-supplied captures are retained unedited as gallery candidates:

- [Syntax highlighting](../editors/phpstorm/images/syntax-highlighting.png): “++PHP generic types and PHP syntax highlighting in the editor.”
- [Import class intention](../editors/phpstorm/images/import-class-intention.png): “Import a missing type from the intention menu, with an import preview.”

Before uploading, review the import-action capture: it includes duplicate action rows, unrelated AI actions, a clipped preview, and a local project path in the Problems panel. Recapture that view with the desired action clearly visible; normalize the two images' framing and aspect ratios. These are real captures, not proof of the qualified-name fix or completion acceptance. The public gallery has not been populated.

Additional useful captures from the packaged plugin in a clean, non-private example project:

- Type completion accepting a short name and adding its sorted import.
- The declaration dialog with namespace and parent-type suggestions.
- A live compiler diagnostic on unsaved code, with the specific message visible.
- Native PHP navigation to a declaration compiled from ++PHP in a mixed project.

Use the IDE's default theme, consistent aspect ratios, readable code, and screenshots at least 1200 × 760 pixels. Exclude personal information, private paths, unrelated notifications, terminal history, browser chrome, and desktop backgrounds. Do not substitute generated mockups, another plugin's screenshots, or historical bug reports for working-feature evidence. Do not illustrate unsupported formatting, PHPDoc tag generation, debugging, or refactoring behavior.

Before publishing, preview both the Marketplace page and the IDE Plugin Manager description, verify gallery legibility, and check every contact link. Publishing remains a separately authorized action; these repository changes do not create or update a public listing.

## Reference comparison

These are language-plugin listings, not VS Code READMEs or framework-plugin manuals:

- [Rust](https://plugins.jetbrains.com/plugin/22407-rust): language-only title, short product description, separate gallery and documentation links.
- [JavaScript and TypeScript](https://plugins.jetbrains.com/plugin/22069-javascript-and-typescript): direct support statement, a Features list, and a short Getting started section.
- [PHP](https://plugins.jetbrains.com/plugin/6610-php): language-only title and compact purpose statement, with compatibility outside the title.
- [Odin Support](https://plugins.jetbrains.com/plugin/22933-odin-support): short language-support statement and feature bullets, with screenshots and contact links in separate fields. Its name is not a reason to add “Support” to ours; current JetBrains guidance discourages redundant naming terms.
- [Zig](https://plugins.jetbrains.com/plugin/10560-zig): language-only title and concrete IDE capabilities, with a separate screenshot gallery. Its embedded logo is not a requirement to duplicate our existing plugin icon in the description.

Adopt the platform's information structure, not every detail of another listing. Our no-release-numbers copy policy still applies even where a reference listing includes runtime ranges or release-specific prose.
