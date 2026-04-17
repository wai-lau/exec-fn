import zipfile, json, io, uuid, time
import rmscene.scene_stream as ss
from rmscene.crdt_sequence import CrdtSequence, CrdtSequenceItem
from rmscene.tagged_block_common import CrdtId, LwwValue

EXEC_RMDOC = "/tmp/EXEC.rmdoc"
EW_RMDOC = "/tmp/executive_wai.rmdoc"
OUT_RMDOC = "/tmp/EXEC_modified.rmdoc"

# get Text and ParagraphStyle types from executive_wai
with zipfile.ZipFile(EW_RMDOC) as z:
    uid_ew = [f for f in z.namelist() if f.endswith(".content")][0].replace(".content", "")
    pid_ew = json.loads(z.read(f"{uid_ew}.content"))["cPages"]["pages"][0]["id"]
    with z.open(f"{uid_ew}/{pid_ew}.rm") as f:
        blocks_ew = list(ss.read_blocks(f))
ref_tb = next(b for b in blocks_ew if isinstance(b, ss.RootTextBlock))
ParagraphStyle = type(list(ref_tb.value.styles.values())[0].value)
TextType = type(ref_tb.value)
print("ParagraphStyle.CHECKBOX =", ParagraphStyle.CHECKBOX)


def make_text_block(block_id_n, pos_x, pos_y, width, paragraphs, author=99):
    """
    paragraphs: list of (text_without_newline, ParagraphStyle)
    """
    crdt_items = {}
    styles = {}
    n = block_id_n * 1000  # offset to avoid collisions between blocks

    prev_id = CrdtId(0, 0)

    for i, (text, style) in enumerate(paragraphs):
        item_id = CrdtId(author, n)
        n += 1
        crdt_items[item_id] = CrdtSequenceItem(
            item_id=item_id,
            left_id=prev_id,
            right_id=CrdtId(0, 0),
            deleted_length=0,
            value=text + "\n"
        )
        # style keyed by predecessor (prev_id)
        styles[prev_id] = LwwValue(timestamp=item_id, value=style)
        prev_id = item_id

    seq = CrdtSequence()
    seq._items = crdt_items

    text_obj = TextType(
        items=seq,
        styles=styles,
        pos_x=float(pos_x),
        pos_y=float(pos_y),
        width=float(width),
    )

    block = ss.RootTextBlock(
        extra_data=b"",
        block_id=CrdtId(author, block_id_n),
        value=text_obj,
    )
    return block


# --- build text blocks ---
CHECKBOX = ParagraphStyle.CHECKBOX
BULLET   = ParagraphStyle.BULLET

active_quests_block = make_text_block(
    block_id_n=1,
    pos_x=-540, pos_y=120, width=750,
    paragraphs=[
        ("make EXEC grab diffs", CHECKBOX),
        ("clean for BotC tmr",   CHECKBOX),
    ]
)

reminders_block = make_text_block(
    block_id_n=2,
    pos_x=-540, pos_y=1360, width=750,
    paragraphs=[
        ("Blades on Saturday!", BULLET),
    ]
)

# --- read EXEC page 0 ---
with zipfile.ZipFile(EXEC_RMDOC) as z:
    uid = [f for f in z.namelist() if f.endswith(".content")][0].replace(".content", "")
    content = json.loads(z.read(f"{uid}.content"))
    page0_id = content["cPages"]["pages"][0]["id"]
    exec_files = {name: z.read(name) for name in z.namelist()}
    with z.open(f"{uid}/{page0_id}.rm") as f:
        blocks_p0 = list(ss.read_blocks(f))

blocks_p0.append(active_quests_block)
blocks_p0.append(reminders_block)

rm_buf = io.BytesIO()
ss.write_blocks(rm_buf, blocks_p0)

# repackage with new uid
new_uid = str(uuid.uuid4())
metadata = json.loads(exec_files[f"{uid}.metadata"])
metadata["new"] = True
metadata["visibleName"] = "EXEC (AI)"
metadata["lastModified"] = str(int(time.time() * 1000))

with zipfile.ZipFile(OUT_RMDOC, 'w', zipfile.ZIP_DEFLATED) as z:
    for name, data in exec_files.items():
        new_name = name.replace(uid, new_uid)
        if name == f"{uid}/{page0_id}.rm":
            z.writestr(new_name, rm_buf.getvalue())
        elif name == f"{uid}.metadata":
            z.writestr(new_name, json.dumps(metadata))
        else:
            z.writestr(new_name, data)

print(f"Wrote {OUT_RMDOC}")
