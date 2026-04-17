import subprocess
result = subprocess.run(["pip", "show", "rmscene"], capture_output=True, text=True)
print(result.stdout)
result2 = subprocess.run(["pip", "index", "versions", "rmscene"], capture_output=True, text=True)
print(result2.stdout or result2.stderr)
