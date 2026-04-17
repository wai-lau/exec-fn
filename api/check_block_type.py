import rmscene.scene_stream as ss
import inspect
src = inspect.getsource(ss.RootTextBlock.from_stream)
print(src)
