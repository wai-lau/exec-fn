import subprocess
result = subprocess.run(["rmapi", "ls"], capture_output=True, text=True)
print(result.stdout)
print(result.stderr)
