// A to-do list: type in the field and press Enter to add an item, press an
// item to tick it off; the list scrolls once it's long. The field is controlled: it clears after each add.
import { For, Input, Scroll, Text, View, createSignal, defineStyle, type InputProps } from "mantou-ui";

const field = defineStyle({
  height: 40,
  paddingLeft: 12,
  paddingRight: 12,
  backgroundColor: "#ffffff",
  borderWidth: 1,
  borderColor: "#d1d5db",
  borderRadius: 8,
  color: "#111827",
  fontSize: 15,
  flexShrink: 0,
  boxShadow: { y: 1, blur: 3, color: "#0f172a14" },
});
const row = defineStyle({ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 8, paddingBottom: 8 });
const box = defineStyle({ width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: "#9ca3af", flexShrink: 0 });

/** An Input with a border that turns blue while it has the focus. */
function Field(props: InputProps) {
  const [focused, setFocused] = createSignal(false);
  return (
    <Input
      {...props}
      style={[field, props.style, focused() && { borderColor: "#2563eb" }]}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

export interface Todo {
  text: string;
  done: boolean;
}

export function Todos(props: { initial?: Todo[] }) {
  const [todos, setTodos] = createSignal<Todo[]>(props.initial ?? []);
  const [draft, setDraft] = createSignal("");
  const add = () => {
    const text = draft().trim();
    if (!text) return;
    setTodos((t) => [...t, { text, done: false }]);
    setDraft("");
  };
  const toggle = (todo: Todo) => setTodos((t) => t.map((x) => (x === todo ? { ...x, done: !x.done } : x)));
  const left = () => todos().filter((t) => !t.done).length;

  return (
    <View style={{ flexGrow: 1, minHeight: 0, padding: 24, gap: 12, backgroundColor: "#f3f4f6" }}>
      <Text style={{ fontSize: 22, fontWeight: 700, color: "#111827" }}>To do</Text>
      <Field
        placeholder="What needs doing?"
        value={draft()}
        onChange={setDraft}
        onSubmit={add}
        maxLength={80}
        autoFocus
      />
      <Scroll style={{ flexGrow: 1, minHeight: 0 }}>
        <For each={todos()}>
          {(todo) => (
            <View style={row} onPress={() => toggle(todo)}>
              <View style={[box, todo.done ? { backgroundColor: "#2563eb", borderColor: "#2563eb" } : {}]} />
              <Text style={{ fontSize: 15, color: todo.done ? "#9ca3af" : "#111827" }}>{todo.text}</Text>
            </View>
          )}
        </For>
      </Scroll>
      <Field style={{ height: "auto", minHeight: 64, paddingTop: 8, paddingBottom: 8 }} placeholder="Notes" multiline />
      <Text style={{ fontSize: 13, color: "#6b7280" }}>{`${left()} left`}</Text>
    </View>
  );
}
