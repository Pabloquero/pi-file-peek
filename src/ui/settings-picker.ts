import { Container, SettingsList, Text } from "@earendil-works/pi-tui";

export type SettingsPickerItem = {
  id: string;
  label: string;
  value: boolean;
  description?: string;
};

export async function openSettingsPicker(
  ctx: any,
  items: SettingsPickerItem[],
  title: string,
  onChange: (id: string, value: boolean) => void,
): Promise<void> {
  if (!ctx?.hasUI) return;
  await ctx.ui.custom((tui: any, theme: any, _kb: any, done: (value: void) => void) => {
    const container = new Container();
    container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
    const settingsList = new SettingsList(
      items.map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description,
        currentValue: item.value ? "on" : "off",
        values: ["off", "on"],
      })),
      Math.min(items.length, 10),
      {
        label: (text: string, selected: boolean) => selected ? theme.fg("accent", text) : text,
        value: (text: string, selected: boolean) => selected ? theme.fg("accent", text) : theme.fg("muted", text),
        description: (text: string) => theme.fg("dim", text),
        cursor: theme.fg("accent", "→ "),
        hint: (text: string) => theme.fg("dim", text),
      },
      (id: string, newValue: string) => {
        onChange(id, newValue === "on");
        tui.requestRender();
      },
      () => {
        tui.requestRender(true);
        done();
      },
    );
    container.addChild(settingsList);
    return {
      render: (width: number) => container.render(Math.min(width, 90)),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => { settingsList.handleInput?.(data); tui.requestRender(); },
    };
  }, { overlay: false });
}
