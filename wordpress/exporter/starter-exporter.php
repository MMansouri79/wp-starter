<?php
/**
 * Plugin Name: WP Starter Exporter
 * Description: پیکربندی قابل انتقال و انتخاب‌شده سایت مرجع را برای ساخت سایت آغازگر صادر می‌کند.
 * Version: 0.2.0-alpha.9
 * Author: MMansouri79
 */

namespace MMS\WPStarter\Exporter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'MMS_WP_STARTER_EXPORTER_VERSION', '0.2.0-alpha.9' );
define( 'MMS_WP_STARTER_EXPORTER_DIR', plugin_dir_path( __FILE__ ) );

require_once MMS_WP_STARTER_EXPORTER_DIR . 'includes/class-exporter.php';
require_once MMS_WP_STARTER_EXPORTER_DIR . 'includes/class-admin-page.php';

Admin_Page::init();
