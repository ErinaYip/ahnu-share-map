from datetime import date
from pathlib import Path

from flask import Flask, redirect, render_template_string, request

app = Flask(__name__, static_folder=".", static_url_path="")

# 待办事项直接存在进程内存里，重启即清空
_todos = []          # [{id, text, completed, createdAt, completedAt}]
_next_id = 1

TEMPLATE = Path(__file__).with_name("index.html").read_text(encoding="utf-8")


def _today():
    return date.today().isoformat()


def _add(text, completed=False, created=None, completed_at=None):
    global _next_id
    _next_id += 1
    todo = {
        "id": _next_id,
        "text": text,
        "completed": completed,
        "createdAt": created or _today(),
    }
    if completed:
        todo["completedAt"] = completed_at or _today()
    _todos.append(todo)


@app.get("/")
def index():
    today = _today()
    # 已完成且不是今天完成的待办隐藏；未完成的排在前面
    display = [t for t in _todos if not t["completed"] or t.get("completedAt") == today]
    display.sort(key=lambda t: t["completed"])
    return render_template_string(TEMPLATE, todos=display, all_todos=_todos)


@app.post("/todos/add")
def add():
    text = request.form.get("text", "").strip()
    if text:
        _add(text)
    return redirect("/")


@app.post("/todos/toggle")
def toggle():
    tid = request.form.get("id", type=int)
    for todo in _todos:
        if todo["id"] == tid:
            todo["completed"] = not todo["completed"]
            if todo["completed"]:
                todo["completedAt"] = _today()
            else:
                todo.pop("completedAt", None)
    return redirect("/")


@app.post("/todos/delete")
def delete():
    tid = request.form.get("id", type=int)
    _todos[:] = [t for t in _todos if t["id"] != tid]
    return redirect("/")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
