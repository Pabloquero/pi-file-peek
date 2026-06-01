import { Container, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";

export type FilePickerItem = { label: string; value: string };

export async function pickFile(ctx: any, items: FilePickerItem[], title: string): Promise<string | undefined> {
  if (!ctx?.hasUI || items.length === 0) return undefined;
  const choice = await ctx.ui.custom((tui: any, theme: any, _kb: any, done: (value: string | null) => void) => {
    const container = new Container();
    container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
    const selectItems: SelectItem[] = items.map((item) => ({ value: item.value, label: item.label }));
    const selectList = new SelectList(selectItems, Math.min(items.length, 10), {
      selectedPrefix: (text: string) => theme.fg("accent", text),
      selectedText: (text: string) => theme.fg("accent", text),
      description: (text: string) => theme.fg("muted", text),
      scrollInfo: (text: string) => theme.fg("dim", text),
      noMatch: (text: string) => theme.fg("warning", text),
    });
    selectList.onSelect = (item) => { tui.requestRender(true); done(item.value); };
    selectList.onCancel = () => { tui.requestRender(true); done(null); };
    container.addChild(selectList);
    container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"), 1, 0));
    return {
      render: (width: number) => container.render(Math.min(width, 90)),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => { selectList.handleInput?.(data); tui.requestRender(); },
    };
  }, { overlay: false }) as string | null | undefined;
  return choice ?? undefined;
}
