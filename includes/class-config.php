<?php
namespace MMS\SiteStarter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Config {
    /**
     * Return the complete starter configuration.
     *
     * This file is intentionally code-based and version controlled. Later, values
     * extracted from the reference site will be added here only after review.
     *
     * @return array
     */
    public static function all() {
        $config = require MSS_DIR . 'config/starter.php';
        return is_array( $config ) ? $config : array();
    }

    /**
     * Get a top-level config key.
     *
     * @param string $key     Config key.
     * @param mixed  $default Fallback value.
     * @return mixed
     */
    public static function get( $key, $default = null ) {
        $config = self::all();
        return array_key_exists( $key, $config ) ? $config[ $key ] : $default;
    }
}
