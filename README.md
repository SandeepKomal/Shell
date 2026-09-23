# Shell — Practical DevOps & DevSecOps Scripts

A collection of reusable **Bash scripts for Linux administration, DevOps, cloud, Docker, Kubernetes, AWS, CI/CD, and DevSecOps** tasks.

The goal is simple: provide small scripts that solve common day-to-day operational problems and are easy to understand, modify, and automate with cron or CI/CD.

## Repository structure

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
│   └── aws_resource_count.sh
└── existing Docker/AWS/GCP utilities
```

## Quick start

```bash
git clone https://github.com/SandeepKomal/Shell.git
cd Shell
chmod +x scripts/check_disk_usage.sh
./scripts/check_disk_usage.sh 80
```

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

## Existing scripts

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

## Security

Never commit AWS access keys, cloud credentials, API tokens, passwords, private keys, Kubernetes kubeconfigs, or production secrets.

The secret scanning script is only a lightweight first check. Use dedicated security tooling in production CI/CD.

See [SECURITY.md](./SECURITY.md).

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

## Validation

```bash
shellcheck scripts/*.sh
bash -n scripts/check_disk_usage.sh
```

## Roadmap

- Kubernetes rollout and deployment checks
- EKS health checks
- AWS cost/resource reporting
- ECR image cleanup
- Terraform validation helpers
- Jenkins/GitHub Actions helpers
- Trivy integration
- Gitleaks integration
- Linux security auditing
- SSL certificate expiry checks
- Backup verification
- Log anomaly detection

## Support the project

If these scripts save you time or help with your DevOps/DevSecOps work, consider giving the repository a star. It helps other engineers discover the toolkit.

## Author

**Sandeep Komal**

Cloud / DevOps Engineer focused on AWS, Kubernetes, Terraform, CI/CD, automation, and DevSecOps.
