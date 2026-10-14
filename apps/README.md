# apps/

App submodules. Each one MIRRORS the parent layout, so the parent finds its
pieces by the same relative paths it uses for its own:

    apps/<name>/api/             python (on sys.path via api/app_paths.py)
    apps/<name>/api/templates/   templates (pages._tmpl searches here after api/templates)
    apps/<name>/web/             static assets, served flat at "/" after web/
    apps/<name>/tests/           tests
    apps/<name>/scripts/         the app's own tooling

The parent wins every name clash (static, templates, modules). Nothing here may
carry a node_modules: uvicorn --reload walks this tree (see ARCHITECTURE.md
§17e). Clone with `git clone --recurse-submodules`; after a pull or reset run
`git submodule update --init`.
