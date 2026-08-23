# Reference Audit Workflow

1. Install Site Starter on the existing fully configured reference site.
2. Open Site Starter → Reference Audit.
3. Click **Download Reference Audit JSON**.
4. Review/share that JSON for baseline extraction.
5. Do not run Initial Setup on the reference site.

The initial audit captures enough structure to identify the baseline while deliberately avoiding broad database dumps.

After review, plugin-specific adapters can be added one by one. This is safer than copying every plugin option because plugins commonly store API tokens, account identifiers, emails, domain-specific data, or transient state alongside ordinary preferences.
