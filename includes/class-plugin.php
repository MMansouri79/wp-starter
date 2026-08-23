<?php
namespace MMS\SiteStarter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Plugin {
    private static $instance;

    /** @return self */
    public static function instance() {
        if ( ! self::$instance ) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function boot() {
        if ( is_admin() ) {
            $admin = new Admin_Page();
            $admin->hooks();
        }
    }
}
