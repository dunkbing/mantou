---
title: Accessibility
description: "The AccessKit tree built from the node tree, the props that feed it, and what the macOS accessibility API reports for the to-do example."
---

[#24](https://github.com/dunkbing/mantou/issues/24). The core builds an [AccessKit](https://accesskit.dev) tree from the node tree and hands it to the OS through `accesskit_winit` while assistive technology is running. Nothing is built or sent otherwise.

## What apps write

A node's role defaults from its kind: `Text` is a label, `Input` a text field (`secure` a password field, `multiline` a text area), `Image` an image, a `View` with `onPress` a button, a scroll view a scroll area, any other `View` a plain container. A control's name is the text inside it. Props override them (one `ACCESS` op per node per turn):

```tsx
<View onPress={() => toggle(todo)} role="checkbox" checked={todo.done}>
  <View style={box} />
  <Text>{todo.text}</Text>          {/* the checkbox is named "Buy rice" */}
</View>
<Input label="New to-do" placeholder="What needs doing?" />
<Text role="status">{`${left()} left`}</Text>
```

| Prop | |
|---|---|
| `role` | `button` `checkbox` `switch` `radio` `link` `heading` `list` `listItem` `dialog` `tab` `tabList` `menu` `menuItem` `image` `group` `status` `alert`; `none` leaves the node itself out (its children stay) |
| `label` | The name, when the text inside isn't the right one |
| `checked` | `true`, `false` or `"mixed"`, for checkbox, switch, radio and menuItem |
| `selected`, `disabled` | |
| `accessHidden` | Leaves the node and what's inside it out |

A password field never exposes its text. Actions: a pressable node can be pressed (the app gets its `onPress`), an input can be focused and have its value set (the core edits it as if typed, so `onChange` fires).

## Tests

- `core/crates/mantou-tree/tests/access.rs`: the tree of a to-do list (roles, names, states, bounds, actions), a password field, state changes, hidden nodes, the focus.
- `examples/todos/Todos.test.tsx`: the real to-do component on the real core: a text field, checkboxes named after their items, a status, and a press flipping one checkbox.

## macOS, checked through the accessibility API

With the to-do example open (two items, one ticked), System Events reads this from the running window:

```
AXGroup
  AXStaticText      value=To do
  AXTextField       title=New to-do
  AXUnknown                                   (the scroll area)
    AXCheckBox      title=Buy rice   value=false   actions=AXPress
    AXCheckBox      title=Call Ana   value=true    actions=AXPress
  AXTextArea        title=Notes
  AXGroup           title=1 left                   (the status)
```

`AXPress` on "Buy rice" ticked it (`value=true`) and the status became "0 left"; setting the text field's `AXValue` to "Pay rent" reached the controlled input.

Known gaps:

- The scroll area reads as `AXUnknown` (AccessKit's scroll view role has no macOS role of its own); a `list` role on it is the likely fix.
- No caret or selection is exposed yet (text fields expose their value only), so VoiceOver doesn't announce the caret moving.
- Several pieces aren't mapped: live regions, heading levels, scrolling by assistive technology, and Windows and Linux haven't been run.

## VoiceOver walkthrough (to do, needs a person)

Run `bun run todos`, turn VoiceOver on (Cmd+F5), then:

1. VO+Right through the window. Expect: "To do", "New to-do, text field", "Notes, text area", "0 left".
2. In the field type "Buy rice" and press Enter. The list should now contain "Buy rice, checkbox, unchecked".
3. Move to the checkbox and press VO+Space. Expect "checked" and the status to change to "0 left".
4. Check what is said when typing and when moving the caret.
