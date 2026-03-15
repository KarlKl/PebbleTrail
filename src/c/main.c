#include <pebble.h>

static Window *s_window;
static Layer *s_canvas_layer;
static TextLayer *s_status_layer;

static bool s_js_ready;
static bool s_show_time_overlay;
static bool s_phone_connected;

static uint8_t *s_image_buffer;
static size_t s_image_buffer_size;
static size_t s_received_bytes;
static uint16_t s_image_width;
static uint16_t s_image_height;
static uint16_t s_image_row_bytes;
static bool s_device_is_color;
static bool s_image_is_color;
static bool s_image_ready;
static AppTimer *s_retry_timer;
static AppTimer *s_time_overlay_timer;

enum
{
  CMD_INIT = 1,
  CMD_IMAGE_CHUNK = 2,
  CMD_BUTTON_CLICK = 3,
  CMD_SAVE_SETTINGS = 4,
  CMD_UPDATE_TIME_OVERLAY = 5,
};

bool comm_is_js_ready()
{
  return s_js_ready;
}

static void prv_schedule_time_overlay_tick(void);

static void prv_set_status_text(const char *text)
{
  if (!s_status_layer)
  {
    return;
  }
  text_layer_set_text(s_status_layer, text);
  layer_set_hidden(text_layer_get_layer(s_status_layer), false);
}

static void prv_draw_time_overlay(Layer *layer, GContext *ctx)
{
  if (!s_show_time_overlay)
  {
    return;
  }

  time_t now = time(NULL);
  struct tm *tick_time = localtime(&now);
  if (!tick_time)
  {
    return;
  }

  char time_text[6];
  strftime(time_text, sizeof(time_text), "%H:%M", tick_time);

  GRect bounds = layer_get_bounds(layer);
  const int16_t overlay_h = 22;
  GRect overlay_bounds = GRect(bounds.size.w / 2 - 20, 0, 40, overlay_h);
  GRect text_bounds = GRect(0, -1, bounds.size.w, overlay_h + 1);

  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_rect(ctx, overlay_bounds, 0, GCornerNone);
  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(
      ctx,
      time_text,
      fonts_get_system_font(FONT_KEY_GOTHIC_18),
      text_bounds,
      GTextOverflowModeTrailingEllipsis,
      GTextAlignmentCenter,
      NULL);
}

static void prv_time_overlay_timer_handler(void *context)
{
  s_time_overlay_timer = NULL;
  if (s_canvas_layer && s_show_time_overlay)
  {
    layer_mark_dirty(s_canvas_layer);
  }
  prv_schedule_time_overlay_tick();
}

static void prv_schedule_time_overlay_tick(void)
{
  if (s_time_overlay_timer)
  {
    app_timer_cancel(s_time_overlay_timer);
    s_time_overlay_timer = NULL;
  }

  time_t now = time(NULL);
  struct tm *tick_time = localtime(&now);
  uint32_t delay_ms = 60000;
  if (tick_time)
  {
    delay_ms = (uint32_t)(60 - tick_time->tm_sec) * 1000;
    if (delay_ms == 0)
    {
      delay_ms = 60000;
    }
  }

  s_time_overlay_timer = app_timer_register(delay_ms, prv_time_overlay_timer_handler, NULL);
}

static void prv_reset_image_state(void)
{
  s_received_bytes = 0;
  s_image_ready = false;
  if (s_image_buffer)
  {
    free(s_image_buffer);
    s_image_buffer = NULL;
    s_image_buffer_size = 0;
  }
}

static void prv_request_render(void)
{
  if (!s_phone_connected)
  {
    return;
  }

  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK)
  {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Failed to begin AppMessage outbox.");
    return;
  }

  dict_write_uint8(iter, MESSAGE_KEY_cmd, CMD_INIT);
  dict_write_uint16(iter, MESSAGE_KEY_width, s_image_width);
  dict_write_uint16(iter, MESSAGE_KEY_height, s_image_height);
  dict_write_uint16(iter, MESSAGE_KEY_bytes_per_row, s_image_row_bytes);
  dict_write_uint8(iter, MESSAGE_KEY_is_color, s_device_is_color ? 1 : 0);

  AppMessageResult result = app_message_outbox_send();
  if (result != APP_MSG_OK)
  {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Error sending the outbox: %d", (int)result);
  }
}

static void prv_retry_timer_handler(void *context)
{
  s_retry_timer = NULL;
  prv_request_render();
}

static void prv_phone_connection_handler(bool connected)
{
  s_phone_connected = connected;

  if (!connected)
  {
    if (s_retry_timer)
    {
      app_timer_cancel(s_retry_timer);
      s_retry_timer = NULL;
    }
    prv_reset_image_state();
    prv_set_status_text("No phone connection");
    if (s_canvas_layer)
    {
      layer_mark_dirty(s_canvas_layer);
    }
    return;
  }
  else
  {
    if (!s_image_ready)
    {
      prv_set_status_text("Loading map...");
    }
    prv_request_render();
  }
}

static void prv_inbox_received_handler(DictionaryIterator *iter, void *context)
{
  Tuple *cmd_t = dict_find(iter, MESSAGE_KEY_cmd);
  if (!cmd_t)
  {
    return;
  }

  APP_LOG(APP_LOG_LEVEL_INFO, "Inbox message received, cmd: %d", cmd_t->value->uint8);
  if (cmd_t->value->uint8 == CMD_INIT)
  {
    Tuple *ready_t = dict_find(iter, MESSAGE_KEY_JSReady);
    if (ready_t)
    {
      s_js_ready = ready_t->value->uint8 != 0;
      APP_LOG(APP_LOG_LEVEL_INFO, "JSReady: %d", s_js_ready);
      Tuple *show_time_t = dict_find(iter, MESSAGE_KEY_showTimeOverlay);
      if (show_time_t)
      {
        s_show_time_overlay = show_time_t->value->uint8 != 0;
        layer_mark_dirty(s_canvas_layer);
      }
      Tuple *canvas_supported_t = dict_find(iter, MESSAGE_KEY_isCanvasSupported);
      if (canvas_supported_t && canvas_supported_t->value->uint8)
      {
        APP_LOG(APP_LOG_LEVEL_INFO, "JS reports canvas support");
        prv_request_render();
      }
      else
      {
        APP_LOG(APP_LOG_LEVEL_WARNING, "JS reports no canvas support");
        // show error message on watch
        text_layer_set_text(s_status_layer, "Canvas not supported :(");
      }
    }
    return;
  }
  else if (cmd_t->value->uint8 == CMD_IMAGE_CHUNK)
  {
    Tuple *width_t = dict_find(iter, MESSAGE_KEY_width);
    Tuple *height_t = dict_find(iter, MESSAGE_KEY_height);
    Tuple *row_bytes_t = dict_find(iter, MESSAGE_KEY_bytes_per_row);
    Tuple *is_color_t = dict_find(iter, MESSAGE_KEY_is_color);
    Tuple *total_t = dict_find(iter, MESSAGE_KEY_total_bytes);
    Tuple *offset_t = dict_find(iter, MESSAGE_KEY_chunk_offset);
    Tuple *data_t = dict_find(iter, MESSAGE_KEY_chunk_data);

    APP_LOG(APP_LOG_LEVEL_INFO, "Received image chunk"); //, offset: %d, length: %d", offset_t ? offset_t->value->uint32 : 0, data_t ? data_t->length : 0);
    if (!offset_t || !data_t)
    {
      return;
    }

    if (width_t)
    {
      s_image_width = width_t->value->uint16;
    }
    if (height_t)
    {
      s_image_height = height_t->value->uint16;
    }
    if (row_bytes_t)
    {
      s_image_row_bytes = row_bytes_t->value->uint16;
    }
    if (is_color_t)
    {
      s_image_is_color = is_color_t->value->uint8 != 0;
    }

    if (total_t && (!s_image_buffer || s_image_buffer_size != total_t->value->uint32))
    {
      prv_reset_image_state();
      s_image_buffer_size = total_t->value->uint32;
      s_image_buffer = malloc(s_image_buffer_size);
      if (!s_image_buffer)
      {
        s_image_buffer_size = 0;
        return;
      }
      memset(s_image_buffer, 0, s_image_buffer_size);
    }

    if (!s_image_buffer)
    {
      return;
    }

    const uint32_t offset = offset_t->value->uint32;
    const uint16_t length = data_t->length;
    if (offset + length > s_image_buffer_size)
    {
      return;
    }

    memcpy(s_image_buffer + offset, data_t->value->data, length);
    s_received_bytes += length;

    if (s_received_bytes >= s_image_buffer_size)
    {
      s_image_ready = true;
      layer_set_hidden(text_layer_get_layer(s_status_layer), true);
      layer_mark_dirty(s_canvas_layer);
    }
  } else if (cmd_t->value->uint8 == CMD_UPDATE_TIME_OVERLAY)
  {
    Tuple *show_time_t = dict_find(iter, MESSAGE_KEY_showTimeOverlay);
    if (show_time_t)
    {
      s_show_time_overlay = show_time_t->value->uint8 != 0;
      layer_mark_dirty(s_canvas_layer);
    }
  }
}

static void prv_outbox_failed_handler(DictionaryIterator *iter, AppMessageResult reason, void *context)
{
  APP_LOG(APP_LOG_LEVEL_ERROR, "AppMessage outbox failed to send: %d", (int)reason);
  if (s_phone_connected && !s_retry_timer)
  {
    s_retry_timer = app_timer_register(1000, prv_retry_timer_handler, NULL);
  }
}

static void prv_canvas_update_proc(Layer *layer, GContext *ctx)
{
  GRect bounds = layer_get_bounds(layer);

  if (!s_image_ready || !s_image_buffer)
  {
    graphics_context_set_fill_color(ctx, GColorWhite);
    graphics_fill_rect(ctx, bounds, 0, GCornerNone);
    prv_draw_time_overlay(layer, ctx);
    return;
  }

  GBitmap *fb = graphics_capture_frame_buffer(ctx);
  if (!fb)
  {
    return;
  }

  uint8_t *fb_data = gbitmap_get_data(fb);
  const uint16_t fb_row_bytes = gbitmap_get_bytes_per_row(fb);
  const uint16_t copy_height = s_image_height < bounds.size.h ? s_image_height : bounds.size.h;

  if (s_image_is_color)
  {
    const uint16_t copy_row_bytes = s_image_width;
    const uint16_t safe_row_bytes = copy_row_bytes < fb_row_bytes ? copy_row_bytes : fb_row_bytes;
    for (uint16_t y = 0; y < copy_height; y++)
    {
      memcpy(fb_data + y * fb_row_bytes, s_image_buffer + y * s_image_row_bytes, safe_row_bytes);
    }
  }
  else if (!s_device_is_color)
  {
    const uint16_t safe_row_bytes = s_image_row_bytes < fb_row_bytes ? s_image_row_bytes : fb_row_bytes;
    for (uint16_t y = 0; y < copy_height; y++)
    {
      memcpy(fb_data + y * fb_row_bytes, s_image_buffer + y * s_image_row_bytes, safe_row_bytes);
    }
  }
  else
  {
    const uint16_t copy_width = s_image_width < bounds.size.w ? s_image_width : bounds.size.w;
    for (uint16_t y = 0; y < copy_height; y++)
    {
      const uint8_t *src_row = s_image_buffer + y * s_image_row_bytes;
      uint8_t *dst_row = fb_data + y * fb_row_bytes;
      for (uint16_t x = 0; x < copy_width; x++)
      {
        const uint8_t src = src_row[x >> 3];
        const bool bit = ((src >> (7 - (x & 7))) & 0x1) != 0;
        dst_row[x] = bit ? 0xFF : 0xC0;
      }
    }
  }

  graphics_release_frame_buffer(ctx, fb);
  prv_draw_time_overlay(layer, ctx);
}

static void prv_window_load(Window *window)
{
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  s_canvas_layer = layer_create(bounds);
  layer_set_update_proc(s_canvas_layer, prv_canvas_update_proc);
  layer_add_child(window_layer, s_canvas_layer);

  s_status_layer = text_layer_create(GRect(0, (bounds.size.h / 2) - 10, bounds.size.w, 20));
  text_layer_set_text(s_status_layer, s_phone_connected ? "Loading map..." : "No phone connection");
  text_layer_set_text_alignment(s_status_layer, GTextAlignmentCenter);
  text_layer_set_background_color(s_status_layer, GColorClear);
  layer_add_child(window_layer, text_layer_get_layer(s_status_layer));

  s_image_width = bounds.size.w;
  s_image_height = bounds.size.h;
  s_device_is_color = false;
#if defined(PBL_COLOR)
  s_device_is_color = true;
#endif
  s_image_is_color = s_device_is_color;

  if (s_device_is_color)
  {
    s_image_row_bytes = s_image_width;
  }
  else
  {
    GBitmap *temp = gbitmap_create_blank(GSize(s_image_width, s_image_height), GBitmapFormat1Bit);
    if (temp)
    {
      s_image_row_bytes = gbitmap_get_bytes_per_row(temp);
      gbitmap_destroy(temp);
    }
    else
    {
      s_image_row_bytes = (s_image_width + 7) / 8;
    }
  }

  prv_reset_image_state();
  prv_schedule_time_overlay_tick();
  if (s_retry_timer)
  {
    app_timer_cancel(s_retry_timer);
    s_retry_timer = NULL;
  }
}

static void prv_window_unload(Window *window)
{
  if (s_js_ready)
  {
    DictionaryIterator *iter;
    if (app_message_outbox_begin(&iter) == APP_MSG_OK)
    {
      dict_write_uint8(iter, MESSAGE_KEY_cmd, CMD_SAVE_SETTINGS);
      app_message_outbox_send();
    }
  }

  text_layer_destroy(s_status_layer);
  layer_destroy(s_canvas_layer);
  if (s_retry_timer)
  {
    app_timer_cancel(s_retry_timer);
    s_retry_timer = NULL;
  }
  if (s_time_overlay_timer)
  {
    app_timer_cancel(s_time_overlay_timer);
    s_time_overlay_timer = NULL;
  }
  prv_reset_image_state();
}

static void prv_focus_handler(bool in_focus)
{
  if (!in_focus)
  {
    return;
  }
  s_phone_connected = connection_service_peek_pebble_app_connection();
  prv_phone_connection_handler(s_phone_connected);
}

static void send_click(int which)
{
  if (!s_phone_connected)
  {
    prv_set_status_text("No phone connection");
    return;
  }

  DictionaryIterator *iter;
  app_message_outbox_begin(&iter);
  dict_write_uint8(iter, MESSAGE_KEY_cmd, CMD_BUTTON_CLICK);
  dict_write_int(iter, MESSAGE_KEY_button_id, &which, sizeof(int), true);
  dict_write_end(iter);
  app_message_outbox_send();
}

static void click_up_handler(ClickRecognizerRef recognizer, void *context)
{
  send_click(-1);
}

static void click_sel_handler(ClickRecognizerRef recognizer, void *context)
{
  send_click(0);
}

static void click_down_handler(ClickRecognizerRef recognizer, void *context)
{
  send_click(1);
}

static void click_config_provider(void *context)
{
  window_single_click_subscribe(BUTTON_ID_UP, click_up_handler);
  window_single_click_subscribe(BUTTON_ID_SELECT, click_sel_handler);
  window_single_click_subscribe(BUTTON_ID_DOWN, click_down_handler);
}

static void prv_init(void)
{
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers){
                                           .load = prv_window_load,
                                           .unload = prv_window_unload,
                                       });

  app_message_register_inbox_received(prv_inbox_received_handler);
  app_message_register_outbox_failed(prv_outbox_failed_handler);
  const uint32_t inbox = app_message_inbox_size_maximum();
  const uint32_t outbox = app_message_outbox_size_maximum();
  app_message_open(inbox, outbox);

  // connection handler
  connection_service_subscribe((ConnectionHandlers){
      .pebble_app_connection_handler = prv_phone_connection_handler,
  });
  s_phone_connected = connection_service_peek_pebble_app_connection();
  app_focus_service_subscribe(prv_focus_handler);

  const bool animated = true;
  window_stack_push(s_window, animated);

  prv_phone_connection_handler(s_phone_connected);

  // button click handlers
  window_set_click_config_provider(s_window, click_config_provider);

  APP_LOG(APP_LOG_LEVEL_INFO, "App initialized with inbox size: %d, outbox size: %d", (int)inbox, (int)outbox);
}

static void prv_deinit(void)
{
  connection_service_unsubscribe();
  window_destroy(s_window);
}

int main(void)
{
  prv_init();
  app_event_loop();
  prv_deinit();
}
