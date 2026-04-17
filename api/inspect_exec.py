import zipfile, json
import rmscene.scene_stream as ss

with zipfile.ZipFile('/app/data/EXEC.rmdoc') as z:
    uid = [f for f in z.namelist() if f.endswith('.content')][0].replace('.content','')
    content = json.loads(z.read(f'{uid}.content'))
    pages = content['cPages']['pages']
    for i, page in enumerate(pages):
        pid = page['id']
        rm_path = f'{uid}/{pid}.rm'
        if rm_path not in z.namelist():
            print(f'Page {i}: no .rm file'); continue
        with z.open(rm_path) as f:
            blocks = list(ss.read_blocks(f))
        print(f'\n--- Page {i} ---')
        for b in blocks:
            name = type(b).__name__
            if isinstance(b, ss.TreeNodeBlock):
                print(f'  {name}: id={b.group.node_id} label={b.group.label.value!r}')
            elif isinstance(b, ss.RootTextBlock):
                print(f'  {name}: pos=({b.value.pos_x},{b.value.pos_y}) width={b.value.width}')
                for item in b.value.items.sequence_items():
                    style = b.value.styles.get(item.left_id)
                    sname = style.value.name if style else '?'
                    print(f'    [{sname}] {repr(item.value)}')
            else:
                print(f'  {name}')
