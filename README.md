# DevOps Nimbus Bash and shell

**Bash and shell, zero to on-call.** Practical Bash scripts for Linux, DevOps, cloud, Kubernetes and personal data, and a free site that teaches bash by fixing scripts that break the way real ones do, for anyone who writes scripts that run in production.

[![Learning site](https://img.shields.io/badge/learn-DevOps%20Nimbus-1d1d1f)](https://sandeepkomal.github.io/Shell/)
[![CI](https://github.com/SandeepKomal/Shell/actions/workflows/ci.yml/badge.svg)](https://github.com/SandeepKomal/Shell/actions/workflows/ci.yml)
[![Pages](https://github.com/SandeepKomal/Shell/actions/workflows/pages.yml/badge.svg)](https://github.com/SandeepKomal/Shell/actions/workflows/pages.yml)
[![Bash](https://img.shields.io/badge/Bash-scripts-4EAA25?logo=gnubash&logoColor=white)](https://www.gnu.org/software/bash/manual/)
![Security](https://img.shields.io/badge/security-ShellCheck%20%C2%B7%20personal--data%20scan-2ea44f)
![No trackers](https://img.shields.io/badge/site-no%20trackers%20%C2%B7%20no%20cookies-2ea44f)
[![Contributions welcome](https://img.shields.io/badge/contributions-welcome-brightgreen)](CONTRIBUTING.md)
![Last commit](https://img.shields.io/github/last-commit/SandeepKomal/Shell)
[![GitHub stars](https://img.shields.io/github/stars/SandeepKomal/Shell?style=social)](https://github.com/SandeepKomal/Shell/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/SandeepKomal/Shell?style=social)](https://github.com/SandeepKomal/Shell/network/members)
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/SandeepKomal/Shell)

**[Open the learning site](https://sandeepkomal.github.io/Shell/)** · [Troubleshoot an error](https://sandeepkomal.github.io/Shell/#doctor) · [Every error on one page](https://sandeepkomal.github.io/Shell/problems.html) · [All DevOps Nimbus tracks](https://sandeepkomal.github.io/devops-nimbus/)

## Contents

- [Learn it in your browser](#learn-it-in-your-browser)
- [What's in this repository](#whats-in-this-repository)
- [Quick start](#quick-start)
- [Real-world automation (new)](#real-world-automation-new)
- [Production automation: AWS, databases, Kubernetes, fleets and personal data](#production-automation-aws-databases-kubernetes-fleets-and-personal-data)
- [Day-to-day DevOps utilities](#day-to-day-devops-utilities)
- [Automation with cron](#automation-with-cron)
- [Script design principles](#script-design-principles)
- [Roadmap](#roadmap)
- [Repository layout](#repository-layout)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Security](#security)
- [Privacy and cost](#privacy-and-cost)
- [License and trademarks](#license-and-trademarks)
- [Author and contributors](#author-and-contributors)

## Learn it in your browser

[DevOps Nimbus Bash and shell](https://sandeepkomal.github.io/Shell/) teaches bash scripting by fixing scripts that break the way real ones do. It is free, needs no account and sends nothing anywhere.

- **Playground**: a bash shell over a small simulated server, with incidents from quoting and exit codes to cron, background jobs, locks, retries and secrets. Run the script, read the real error, edit it, run it again.
- **Path**: levels from a first script to production incidents, each with a lab that uses the scripts in this repository.
- **Script X-ray**: paste a script to see every line explained and risky lines flagged.
- **Troubleshoot**: every common bash error with its cause, how to confirm it, the fix and how to prevent it; also as one plain page, [problems.html](https://sandeepkomal.github.io/Shell/problems.html).
- **Quiz**, **Cheat sheet** and **How bash runs** (how bash runs a command line).
- **Scripts**: a catalogue of every script in `scripts/`, with its usage, sample output and exit codes.
- **Your learning**: a score, a skill radar, a learning-uptime page and on-call shifts against the clock, kept in your browser; **Download my progress** and **Load my progress** move it between browsers.

The site is static HTML, CSS and JavaScript in `site/`, published with GitHub Pages. To work on it, open `site/index.html` in a browser or serve the folder (`python3 -m http.server -d site`), and run the tests:

```bash
node tests/check_site_data.js     # content, links, cheat sheet rows, problems.html
node tests/check_playground.js    # every scenario starts broken; wrong moves fail; fixes work
node tests/check_bash_parity.js   # the playground's bash prints what bash 5.2 prints
node tests/check_xray.js          # X-ray rules
node tests/fuzz_playground.js     # thousands of random commands, no exceptions
node tools/build_problems.js      # regenerate site/problems.html after editing Troubleshoot entries
```

## What's in this repository

A collection of reusable **Bash scripts for Linux administration, DevOps, cloud, Docker, Kubernetes, AWS, CI/CD, and DevSecOps** tasks.

The goal is simple: provide small scripts that solve common day-to-day operational problems and are easy to understand, modify, and automate with cron or CI/CD.

### Existing scripts

The repository also contains examples for:

- Backups
- Disk usage
- HTTP response times
- Listening ports
- Network connectivity
- Service health
- System uptime
- Automatic package updates
- Docker cleanup
- AWS resources
- GCP resources
- Git pre-commit checks

## Quick start

```bash
git clone https://github.com/SandeepKomal/Shell.git
cd Shell
chmod +x scripts/check_disk_usage.sh
./scripts/check_disk_usage.sh 80
```

## Real-world automation (new)

Scripts for the jobs that come up every week in operations, each with `-h`, safe defaults (dry runs before deletes), clear exit codes for cron and CI, and tests in `tests/`.

### Shell (`scripts/`)

| Script | What it is for |
| --- | --- |
| `retry.sh` | Retry a flaky command with exponential backoff and jitter: registry pushes, package mirrors, rate-limited APIs |
| `wait_for.sh` | Wait until a `host:port` or URL answers, with a timeout: start an app only when its database is up |
| `ssl_cert_expiry.sh` | Fail when any TLS certificate expires within N days; hosts from arguments or a file |
| `backup_rotate.sh` | Dated `.tar.gz` backup with a SHA-256 checksum, verified after writing, keeping the newest N |
| `release_deploy.sh` | Deploy into `releases/<timestamp>`, switch the `current` symlink atomically, roll back in one command |
| `incident_snapshot.sh` | Read-only snapshot of a host during an incident (load, memory, disks, sockets, kernel and systemd logs) in one archive |
| `deleted_open_files.sh` | "Disk full but du finds nothing": files deleted while a process still holds them open |
| `user_access_audit.sh` | Access review: login shells, extra UID 0 accounts, sudo members, NOPASSWD rules, empty passwords, last logins |
| `git_prune_branches.sh` | Delete branches already merged, locally and optionally on origin; dry run by default, main and release branches protected |
| `preflight_check.sh` | Before a deploy: required commands, environment variables (never printed), free disk, free ports |

```bash
./scripts/retry.sh -n 5 -- docker push registry.example.com/app:1.4.2
./scripts/wait_for.sh -t 60 db:5432 && ./start-app
./scripts/ssl_cert_expiry.sh -w 21 -f hosts.txt
./scripts/backup_rotate.sh -k 14 /srv/app/data /backups
./scripts/release_deploy.sh deploy /srv/app ./build 5
./scripts/release_deploy.sh rollback /srv/app
sudo ./scripts/incident_snapshot.sh /root
sudo ./scripts/deleted_open_files.sh 100
./scripts/git_prune_branches.sh -r          # look first, then add -y
./scripts/preflight_check.sh -c "docker kubectl" -e "IMAGE_TAG" -d /var:5 -p 8080
```

### Tests

```bash
tests/test_scripts.sh      # runs the scripts in throwaway directories
```

## Production automation: AWS, databases, Kubernetes, fleets and personal data

Eighteen scripts for the automation teams write at work: AWS, database backups, Kubernetes, fleets of hosts, Terraform drift, and personal data under India's Digital Personal Data Protection Act, 2023. They follow the same rules as the scripts above: `set -euo pipefail`, `-h` and `--help`, documented exit codes (0 ok, 1 found a problem or failed, 2 usage or configuration error), cleanup traps and locks where they matter, ShellCheck clean, and tested in `tests/test_scripts.sh` with the cloud and database tools stubbed. **Anything that changes or deletes is a dry run until you add `-y`**; the backup scripts write a new backup by default and take `-n` for a dry run. AWS scripts read credentials only from the AWS CLI's usual chain and list the minimum IAM permissions in their header.

| Script | What it is for |
| --- | --- |
| `ec2_by_tag.sh` | List EC2 instances by tag; stop, start or reboot exactly those, capped by `-m`; `-j` for JSON |
| `s3_backup_sync.sh` | Copy backups to S3 with server-side encryption and verify; refuses an empty source, so an unmounted disk cannot wipe the bucket |
| `ecr_cleanup.sh` | Delete untagged and old ECR images, never protected tags or the parts of multi-arch images |
| `pg_backup.sh` | Consistent `pg_dump`, verified with `pg_restore --list`, SHA-256, rotation, optional encrypted S3 copy |
| `mysql_backup.sh` | `mysqldump --single-transaction`, gzip, checked for the "Dump completed" line, rotation, optional S3 copy; credentials from an option file |
| `k8s_rollout.sh` | New image on a Deployment, wait with a timeout, roll back automatically when it is not healthy |
| `k8s_node_drain.sh` | Cordon and drain through the Eviction API so PodDisruptionBudgets hold; never `--force` |
| `k8s_collect_logs.sh` | Pods, events, describe output and current and previous logs of a namespace in one private archive |
| `with_lock.sh` | Run a command only if no other copy runs (`flock`), with a time limit: the wrapper for cron jobs |
| `multi_host_run.sh` | One command on many hosts over ssh, in parallel, grouped output and a list of failures |
| `patch_report.sh` | Pending and security updates and reboot-required on apt, dnf, yum and zypper hosts; `-j` for JSON |
| `nginx_safe_reload.sh` | `nginx -t`, reload (not restart), then prove the site answers |
| `journal_errors.sh` | Errors in the systemd journal per unit and the most common messages, with personal data folded out |
| `terraform_drift_check.sh` | Plan with `-detailed-exitcode` and `-lock=false` per root module, list what drifted; never applies |
| `pii_scan.sh` | Find Aadhaar (Verhoeff-checked), PAN, mobile, e-mail, UPI, bank account with IFSC, passport and voter ID numbers; masked report, counts per file |
| `pii_redact.sh` | Mask those identifiers on a stream or in log files in place |
| `retention_cleanup.sh` | Delete files past a retention period, dry run first, with an erasure log |
| `breach_evidence.sh` | Breach-response evidence (login, sudo and web request timelines, changed files, checksums) without copying the personal data |

```bash
./scripts/ec2_by_tag.sh -r ap-south-1 -s running -a stop Environment=dev        # look, then add -y
./scripts/s3_backup_sync.sh -c STANDARD_IA /var/backups/pg s3://<bucket>/pg      # dry run, then -y
PGHOST=db.internal PGUSER=backup ./scripts/pg_backup.sh -k 14 shop /var/backups/pg
./scripts/k8s_rollout.sh -x prod -n shop -y api registry.example.com/shop/api:1.4.2
./scripts/with_lock.sh -n report -t 600 -s -- ./nightly_report.sh
./scripts/multi_host_run.sh -f hosts.txt -p 10 -y -- systemctl is-active nginx
./scripts/terraform_drift_check.sh envs/prod envs/staging
./scripts/pii_scan.sh /var/log/shop
tail -F /var/log/shop/app.log | ./scripts/pii_redact.sh
./scripts/retention_cleanup.sh -d 180 -p '*.csv' /srv/exports                  # dry run, then -y
sudo ./scripts/breach_evidence.sh -s "2026-10-30 18:00" -i "203.0.113.7" -n INC-1042 -o /root/cases
```

The personal-data scripts and the site's two privacy-engineering levels are practical engineering guidance for India's DPDP Act, not legal advice.

## Day-to-day DevOps utilities

### Linux
```bash
./scripts/check_disk_usage.sh 80
./scripts/check_service.sh nginx
./scripts/check_port.sh 8080
./scripts/process_watch.sh
./scripts/find_large_files.sh /var 500M
./scripts/rotate_app_logs.sh /var/log/myapp.log 5
```

### Application monitoring
```bash
./scripts/check_http_endpoint.sh https://example.com
```

### Docker
```bash
./scripts/docker_health.sh my-container
```

### Kubernetes
```bash
./scripts/k8s_pod_health.sh default
```

### AWS
```bash
./scripts/aws_resource_count.sh us-east-1
```

The AWS script uses the credentials and permissions configured for the AWS CLI and does not create or modify resources.

### DevSecOps
```bash
./scripts/scan_for_secrets.sh
```

This is a lightweight pattern check, not a replacement for dedicated scanners such as Gitleaks or TruffleHog.

## Automation with cron

```bash
crontab -e
```

Example:

```cron
*/15 * * * * /path/to/check_disk_usage.sh 80 >> /var/log/disk-check.log 2>&1
```

Review scheduled jobs:

```bash
crontab -l
```

Prefer absolute paths in cron jobs and ensure the executing user has the required permissions.

## Script design principles

New scripts aim to use:

- `#!/usr/bin/env bash`
- `set -euo pipefail`
- Explicit argument validation
- Non-zero exit codes on failures
- No hard-coded credentials
- Safe variable quoting
- Clear operational output

## Roadmap

- Kubernetes rollout and deployment checks
- EKS health checks
- AWS cost/resource reporting
- ECR image cleanup
- Terraform validation helpers
- Jenkins/GitHub Actions helpers
- Trivy integration
- Gitleaks integration
- Log anomaly detection

## Repository layout

```text
Shell/
├── Backup Script/
├── Disk Usage/
├── HTTP Response Times/
├── Listening Ports Script/
├── Monitor System Processes & Memory Usage/
├── Network Connectivity Check/
├── Service Health Check/
├── System Uptime Check/
├── Automatic Package Updates/
├── site/                 # DevOps Nimbus Bash and shell, the learning site (GitHub Pages)
├── tools/                # build_problems.js for site/problems.html
├── tests/                # test_scripts.sh and the site's node tests
├── PRIVACY.md            # privacy policy (India's DPDP Act)
├── scripts/
│   ├── check_disk_usage.sh
│   ├── check_http_endpoint.sh
│   ├── check_service.sh
│   ├── check_port.sh
│   ├── process_watch.sh
│   ├── rotate_app_logs.sh
│   ├── find_large_files.sh
│   ├── git_changed_files.sh
│   ├── scan_for_secrets.sh
│   ├── docker_health.sh
│   ├── k8s_pod_health.sh
│   ├── aws_resource_count.sh
│   ├── ...                  # retry, wait_for, backups, deploys, audits (see the catalogue below)
│   ├── ec2_by_tag.sh, s3_backup_sync.sh, ecr_cleanup.sh
│   ├── pg_backup.sh, mysql_backup.sh
│   ├── k8s_rollout.sh, k8s_node_drain.sh, k8s_collect_logs.sh
│   ├── with_lock.sh, multi_host_run.sh, patch_report.sh, nginx_safe_reload.sh, journal_errors.sh, terraform_drift_check.sh
│   └── pii_scan.sh, pii_redact.sh, retention_cleanup.sh, breach_evidence.sh
└── existing Docker/AWS/GCP utilities
```

## Troubleshooting

Look up an error in the site's [Troubleshoot](https://sandeepkomal.github.io/Shell/#doctor) page, or read every entry on [one plain page](https://sandeepkomal.github.io/Shell/problems.html): bash errors, and the AWS, database, Kubernetes, fleet and personal-data errors the scripts above run into, each with how to confirm, fix and prevent it. Every script answers `-h` with its usage and exit codes.

## Contributing

Contributions are welcome, especially new practical DevOps scripts, DevSecOps automation, Kubernetes utilities, AWS automation, Linux troubleshooting scripts, bug fixes, and better error handling.

Before submitting a pull request:

1. Test the script in a safe environment.
2. Run ShellCheck where available.
3. Avoid destructive defaults.
4. Never include credentials or secrets.
5. Document required tools and permissions.
6. Explain how the script was tested.

See [CONTRIBUTING.md](./CONTRIBUTING.md).

### Validation

```bash
shellcheck scripts/*.sh
bash -n scripts/check_disk_usage.sh
tests/test_scripts.sh
```

CI runs ShellCheck and the test suite on every pull request.

## Security

Never commit AWS access keys, cloud credentials, API tokens, passwords, private keys, Kubernetes kubeconfigs, or production secrets.

The secret scanning script is only a lightweight first check. Use dedicated security tooling in production CI/CD.

See [SECURITY.md](./SECURITY.md).

CI runs ShellCheck on the production scripts and their tests, and `scripts/pii_scan.sh` over the whole repository so no real personal data is committed (the synthetic test values are allowlisted in `.piiallow`). `scripts/scan_for_secrets.sh` is a local check for secrets. Report a vulnerability privately as described in [SECURITY.md](./SECURITY.md).

## Privacy and cost

The learning site runs entirely in your browser: no accounts, cookies, trackers or database, and nothing is loaded from other sites. Your progress stays in your browser's storage. The site is free on GitHub Pages. The AWS scripts act on your own account and can incur AWS charges (S3 storage and requests, for example); they read only what they need and change nothing without `-y`.

See [PRIVACY.md](PRIVACY.md) for the full privacy policy.

## License and trademarks

The site is published as open source under the MIT License; this repository does not yet include a LICENSE file.

Bash is a GNU project of the Free Software Foundation. This project is independent and not affiliated with the FSF or the GNU project. AWS, Kubernetes, Terraform and other product names are trademarks of their owners; this project is not affiliated with them.

## Author and contributors

**Sandeep Komal** · [github.com/SandeepKomal](https://github.com/SandeepKomal)

Cloud / DevOps Engineer focused on AWS, Kubernetes, Terraform, CI/CD, automation, and DevSecOps.

Built and maintained with [DevopsNimbus](https://github.com/DevopsNimbus). See everyone who has contributed in the [contributors graph](https://github.com/SandeepKomal/Shell/graphs/contributors).

If these scripts save you time or help with your DevOps/DevSecOps work, consider giving the repository a star. It helps other engineers discover the toolkit.

If this helped you, a ⭐ on the repository helps others find it.
