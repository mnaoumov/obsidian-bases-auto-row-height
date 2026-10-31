const DEFAULT_MAX_ROWS = 500;

export class PluginSettings {
  /**
   * The most rows a table with the Auto row height may have and still be laid out by its content. A larger
   * table keeps fixed-height rows, because an auto table renders every row.
   */
  public maxRows = DEFAULT_MAX_ROWS;
}
