import subprocess

# Check what commit we have installed
result = subprocess.run(["pip", "show", "-f", "rmscene"], capture_output=True, text=True)
for line in result.stdout.splitlines():
    if "Location" in line:
        print(line)

# Try to find the installed git hash
import rmscene
import os
loc = os.path.dirname(rmscene.__file__)
print("location:", loc)

# Check the unreadable block type id
import rmscene.tagged_block_reader as tbr
import inspect
src = inspect.getsource(tbr)
# find where UnreadableBlock is created
for i, line in enumerate(src.splitlines()):
    if "Unreadable" in line or "unreadable" in line:
        print(f"  line {i}: {line}")
