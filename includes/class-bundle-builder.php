<?php
namespace MMS\SiteStarter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Bundle_Builder {
    const BUILD_ROOT_NAME = 'site-starter-private-builds';

    /** @return bool */
    public function supported() {
        return class_exists( '\\ZipArchive' ) || file_exists( ABSPATH . 'wp-admin/includes/class-pclzip.php' );
    }

    /**
     * Build the staged export queue. The export includes the superset of
     * dependencies required by every configured profile so one ZIP can be used
     * for Elementor-only, WooCommerce, English and Persian installations.
     *
     * @return array[]
     */
    public function build_queue() {
        $queue   = array();
        $theme   = Config::get( 'theme', array() );
        $plugins = Config::get( 'plugins', array() );

        if ( ! empty( $theme['slug'] ) ) {
            $queue[] = array(
                'type'  => 'bundle-theme',
                'label' => 'Package theme: ' . ( ! empty( $theme['name'] ) ? $theme['name'] : $theme['slug'] ),
            );
        }

        foreach ( $this->profile_plugin_ids() as $plugin_id ) {
            if ( empty( $plugins[ $plugin_id ] ) ) {
                continue;
            }

            $queue[] = array(
                'type'      => 'bundle-plugin',
                'plugin_id' => $plugin_id,
                'label'     => 'Package plugin: ' . ( ! empty( $plugins[ $plugin_id ]['name'] ) ? $plugins[ $plugin_id ]['name'] : $plugin_id ),
            );
        }

        $queue[] = array(
            'type'  => 'bundle-languages',
            'label' => 'Package installed WordPress language files',
        );

        $queue[] = array(
            'type'  => 'bundle-finalize',
            'label' => 'Assemble final offline installer ZIP',
        );

        return $queue;
    }

    /**
     * @return string[]
     */
    private function profile_plugin_ids() {
        $profiles = Config::get( 'profiles', array() );
        $ids      = array();

        foreach ( $profiles as $profile ) {
            if ( empty( $profile['plugins'] ) || ! is_array( $profile['plugins'] ) ) {
                continue;
            }
            foreach ( $profile['plugins'] as $plugin_id ) {
                $ids[ $plugin_id ] = true;
            }
        }

        return array_keys( $ids );
    }

    /**
     * @param string $token Random build token.
     * @return true|string
     */
    public function prepare( $token ) {
        if ( ! $this->supported() ) {
            return 'No ZIP implementation is available. Site Starter needs PHP ZipArchive or WordPress PclZip.';
        }

        $this->cleanup_stale_builds();

        $dir = $this->build_dir( $token );
        foreach ( array( $dir, $dir . '/packages', $dir . '/packages/plugins', $dir . '/packages/themes', $dir . '/packages/languages' ) as $path ) {
            if ( ! wp_mkdir_p( $path ) ) {
                return 'Could not create the private Site Starter build directory.';
            }
        }

        $this->write_protection_files( dirname( $dir ) );
        $this->write_protection_files( $dir );
        return true;
    }

    /**
     * Execute one export step.
     *
     * @param string $token Build token.
     * @param array  $step Queue step.
     * @return array{results:array[],output_file?:string,filename?:string}
     */
    public function run_step( $token, array $step ) {
        if ( ! $this->supported() ) {
            return array( 'results' => array( $this->result( 'error', 'Offline Installer', 'PHP ZipArchive is not available.' ) ) );
        }

        $type = isset( $step['type'] ) ? $step['type'] : '';

        switch ( $type ) {
            case 'bundle-theme':
                return array( 'results' => array( $this->package_theme( $token ) ) );

            case 'bundle-plugin':
                return array( 'results' => array( $this->package_plugin( $token, isset( $step['plugin_id'] ) ? $step['plugin_id'] : '' ) ) );

            case 'bundle-languages':
                return array( 'results' => array( $this->package_languages( $token ) ) );

            case 'bundle-finalize':
                return $this->finalize( $token );
        }

        return array( 'results' => array( $this->result( 'error', 'Offline Installer', 'Unknown bundle-build step.' ) ) );
    }

    /**
     * @param string $token Build token.
     * @return array
     */
    private function package_theme( $token ) {
        $theme = Config::get( 'theme', array() );
        if ( empty( $theme['slug'] ) || empty( $theme['package'] ) ) {
            return $this->result( 'error', 'Theme', 'Starter theme package path is not configured.' );
        }

        $source = trailingslashit( get_theme_root( $theme['slug'] ) ) . $theme['slug'];
        if ( ! is_dir( $source ) ) {
            return $this->result( 'error', $theme['name'], 'The configured reference theme directory does not exist on this site.' );
        }

        $destination = $this->build_dir( $token ) . '/' . ltrim( $theme['package'], '/\\' );
        $result      = $this->zip_directory( $source, $destination, basename( $source ) );
        if ( true !== $result ) {
            return $this->result( 'error', $theme['name'], $result );
        }

        return $this->result( 'success', $theme['name'], 'Theme files packaged from the reference site.' );
    }

    /**
     * @param string $token Build token.
     * @param string $plugin_id Config plugin ID.
     * @return array
     */
    private function package_plugin( $token, $plugin_id ) {
        $plugins = Config::get( 'plugins', array() );
        if ( empty( $plugins[ $plugin_id ] ) ) {
            return $this->result( 'error', 'Plugin', 'Unknown plugin ID: ' . $plugin_id );
        }

        $plugin = $plugins[ $plugin_id ];
        if ( empty( $plugin['file'] ) || empty( $plugin['package'] ) ) {
            return $this->result( 'error', $plugin['name'], 'Plugin file/package path is not configured.' );
        }

        $main_file = WP_PLUGIN_DIR . '/' . ltrim( $plugin['file'], '/\\' );
        if ( ! file_exists( $main_file ) ) {
            return $this->result( 'error', $plugin['name'], 'The plugin is not installed on the reference site, so its files cannot be bundled.' );
        }

        $source      = dirname( $main_file );
        $destination = $this->build_dir( $token ) . '/' . ltrim( $plugin['package'], '/\\' );
        $result      = $this->zip_directory( $source, $destination, basename( $source ) );
        if ( true !== $result ) {
            return $this->result( 'error', $plugin['name'], $result );
        }

        return $this->result( 'success', $plugin['name'], 'Plugin files packaged from the reference site.' );
    }

    /**
     * Package WP_LANG_DIR as a portable archive. This includes core, plugin and
     * theme translation files already installed on the reference site. It does
     * not make any translation API request.
     *
     * @param string $token Build token.
     * @return array
     */
    private function package_languages( $token ) {
        $packages = Config::get( 'language_packages', array() );
        $relative = isset( $packages['fa_IR'] ) ? ltrim( $packages['fa_IR'], '/\\' ) : 'packages/languages/reference-languages.zip';
        $target   = $this->build_dir( $token ) . '/' . $relative;

        if ( ! is_dir( WP_LANG_DIR ) ) {
            return $this->result( 'error', 'Languages', 'WP_LANG_DIR does not exist on the reference site.' );
        }

        require_once ABSPATH . 'wp-admin/includes/translation-install.php';
        if ( ! in_array( 'fa_IR', get_available_languages(), true ) && 'fa_IR' === get_locale() ) {
            return $this->result( 'error', 'Languages', 'The reference site is Persian, but WordPress cannot detect installed fa_IR core language files.' );
        }

        $result = $this->zip_directory( WP_LANG_DIR, $target, '' );
        if ( true !== $result ) {
            return $this->result( 'error', 'Languages', $result );
        }

        return $this->result( 'success', 'Languages', 'Installed WordPress core/plugin/theme language files packaged for offline use.' );
    }

    /**
     * @param string $token Build token.
     * @return array
     */
    private function finalize( $token ) {
        $build_dir = $this->build_dir( $token );
        if ( ! is_dir( $build_dir . '/packages' ) ) {
            return array( 'results' => array( $this->result( 'error', 'Offline Installer', 'Bundle package directory is missing.' ) ) );
        }

        $assembly = $build_dir . '/assembly/site-starter';
        $this->delete_tree( dirname( $assembly ) );
        if ( ! wp_mkdir_p( $assembly ) ) {
            return array( 'results' => array( $this->result( 'error', 'Offline Installer', 'Could not create the final assembly directory.' ) ) );
        }

        $source_result = $this->copy_directory_filtered(
            MSS_DIR,
            $assembly,
            array( '.git', '.github', 'packages' )
        );
        if ( true !== $source_result ) {
            return array( 'results' => array( $this->result( 'error', 'Offline Installer', $source_result ) ) );
        }

        $packages_result = $this->copy_directory_filtered( $build_dir . '/packages', $assembly . '/packages', array() );
        if ( true !== $packages_result ) {
            return array( 'results' => array( $this->result( 'error', 'Offline Installer', $packages_result ) ) );
        }

        if ( false === file_put_contents(
            $assembly . '/bundle-manifest.json',
            wp_json_encode( $this->manifest(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES )
        ) ) {
            return array( 'results' => array( $this->result( 'error', 'Offline Installer', 'Could not write bundle-manifest.json.' ) ) );
        }

        $filename = 'site-starter-offline-v' . MSS_VERSION . '-' . gmdate( 'Ymd-His' ) . '.zip';
        $output   = $build_dir . '/' . $filename;
        $zipped   = $this->zip_directory( $assembly, $output, 'site-starter' );
        if ( true !== $zipped ) {
            @unlink( $output );
            return array( 'results' => array( $this->result( 'error', 'Offline Installer', $zipped ) ) );
        }

        if ( ! file_exists( $output ) || filesize( $output ) < 1024 ) {
            return array( 'results' => array( $this->result( 'error', 'Offline Installer', 'Final installer ZIP was not created correctly.' ) ) );
        }

        $this->delete_tree( dirname( $assembly ) );

        return array(
            'results'     => array( $this->result( 'success', 'Offline Installer', 'Complete self-contained installer ZIP assembled. No WordPress.org access is required on the destination site.' ) ),
            'output_file' => $output,
            'filename'    => $filename,
        );
    }

    /** @return array */
    private function manifest() {
        if ( ! function_exists( 'get_plugins' ) ) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }

        $installed = get_plugins();
        $plugins   = array();
        foreach ( Config::get( 'plugins', array() ) as $plugin_id => $definition ) {
            $file = isset( $definition['file'] ) ? $definition['file'] : '';
            $plugins[ $plugin_id ] = array(
                'name'    => isset( $definition['name'] ) ? $definition['name'] : $plugin_id,
                'file'    => $file,
                'version' => isset( $installed[ $file ]['Version'] ) ? $installed[ $file ]['Version'] : '',
                'package' => isset( $definition['package'] ) ? $definition['package'] : '',
            );
        }

        $theme = Config::get( 'theme', array() );
        $theme_obj = ! empty( $theme['slug'] ) ? wp_get_theme( $theme['slug'] ) : null;

        return array(
            'format_version'       => 1,
            'site_starter_version' => MSS_VERSION,
            'generated_at'         => gmdate( 'c' ),
            'generated_from'       => array(
                'wordpress_version' => get_bloginfo( 'version' ),
                'php_version'       => PHP_VERSION,
                'locale'            => get_locale(),
            ),
            'theme' => array(
                'slug'    => isset( $theme['slug'] ) ? $theme['slug'] : '',
                'version' => $theme_obj && $theme_obj->exists() ? $theme_obj->get( 'Version' ) : '',
                'package' => isset( $theme['package'] ) ? $theme['package'] : '',
            ),
            'plugins'             => $plugins,
            'language_packages'   => Config::get( 'language_packages', array() ),
            'network_required'    => false,
        );
    }

    /**
     * Create a ZIP from a directory.
     *
     * @param string $source Source directory.
     * @param string $destination ZIP path.
     * @param string $archive_root Optional root directory inside ZIP.
     * @return true|string
     */
    private function zip_directory( $source, $destination, $archive_root ) {
        if ( ! is_dir( $source ) ) {
            return 'Source directory does not exist: ' . $source;
        }

        if ( ! wp_mkdir_p( dirname( $destination ) ) ) {
            return 'Could not create the package output directory.';
        }

        $files = array();
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator( $source, \FilesystemIterator::SKIP_DOTS ),
            \RecursiveIteratorIterator::LEAVES_ONLY
        );
        foreach ( $iterator as $item ) {
            if ( $item->isFile() && ! $item->isLink() ) {
                $files[] = $item->getPathname();
            }
        }

        if ( empty( $files ) ) {
            return 'The source directory contained no files to package.';
        }

        @unlink( $destination );

        if ( class_exists( '\\ZipArchive' ) ) {
            $zip    = new \ZipArchive();
            $opened = $zip->open( $destination, \ZipArchive::CREATE | \ZipArchive::OVERWRITE );
            if ( true !== $opened ) {
                return sprintf( 'Could not create ZIP package (ZipArchive code %s).', (string) $opened );
            }

            $source_len = strlen( rtrim( $source, '/\\' ) ) + 1;
            foreach ( $files as $file ) {
                $relative = str_replace( '\\', '/', substr( $file, $source_len ) );
                $inside   = $archive_root ? trim( $archive_root, '/\\' ) . '/' . $relative : $relative;
                if ( ! $zip->addFile( $file, $inside ) ) {
                    $zip->close();
                    @unlink( $destination );
                    return 'Could not add a file to the package: ' . $relative;
                }
            }
            $zip->close();
            return true;
        }

        require_once ABSPATH . 'wp-admin/includes/class-pclzip.php';
        $archive = new \PclZip( $destination );
        $args    = array(
            $files,
            PCLZIP_OPT_REMOVE_PATH,
            rtrim( $source, '/\\' ),
        );
        if ( $archive_root ) {
            $args[] = PCLZIP_OPT_ADD_PATH;
            $args[] = trim( $archive_root, '/\\' );
        }
        $list = call_user_func_array( array( $archive, 'create' ), $args );

        if ( 0 === $list ) {
            @unlink( $destination );
            return 'PclZip could not create the package: ' . wp_strip_all_tags( $archive->errorInfo( true ) );
        }

        return true;
    }

    /**
     * Copy a directory tree while excluding selected top-level paths.
     *
     * @param string   $source Source directory.
     * @param string   $destination Destination directory.
     * @param string[] $exclude_top Top-level names to skip.
     * @return true|string
     */
    private function copy_directory_filtered( $source, $destination, array $exclude_top ) {
        if ( ! is_dir( $source ) ) {
            return 'Could not find directory while assembling installer: ' . $source;
        }
        if ( ! wp_mkdir_p( $destination ) ) {
            return 'Could not create directory while assembling installer: ' . $destination;
        }

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator( $source, \FilesystemIterator::SKIP_DOTS ),
            \RecursiveIteratorIterator::SELF_FIRST
        );
        $source_len = strlen( rtrim( $source, '/\\' ) ) + 1;

        foreach ( $iterator as $item ) {
            if ( $item->isLink() ) {
                continue;
            }
            $relative = str_replace( '\\', '/', substr( $item->getPathname(), $source_len ) );
            $top      = strtok( $relative, '/' );
            if ( in_array( $top, $exclude_top, true ) ) {
                continue;
            }

            $target = rtrim( $destination, '/\\' ) . '/' . $relative;
            if ( $item->isDir() ) {
                if ( ! wp_mkdir_p( $target ) ) {
                    return 'Could not create directory while assembling installer: ' . $relative;
                }
            } elseif ( $item->isFile() ) {
                if ( ! wp_mkdir_p( dirname( $target ) ) || ! copy( $item->getPathname(), $target ) ) {
                    return 'Could not copy file while assembling installer: ' . $relative;
                }
            }
        }

        return true;
    }

    /** @return string */
    public function build_dir( $token ) {
        $safe = preg_replace( '/[^A-Za-z0-9_-]/', '', (string) $token );
        return trailingslashit( WP_CONTENT_DIR ) . self::BUILD_ROOT_NAME . '/' . $safe;
    }

    /**
     * Remove one build directory recursively.
     *
     * @param string $token Build token.
     * @return void
     */
    public function cleanup( $token ) {
        $dir = $this->build_dir( $token );
        $this->delete_tree( $dir );
    }

    /** @return void */
    private function cleanup_stale_builds() {
        $root = trailingslashit( WP_CONTENT_DIR ) . self::BUILD_ROOT_NAME;
        if ( ! is_dir( $root ) ) {
            return;
        }

        $entries = glob( $root . '/*', GLOB_ONLYDIR );
        if ( ! is_array( $entries ) ) {
            return;
        }

        foreach ( $entries as $dir ) {
            $mtime = @filemtime( $dir );
            if ( $mtime && $mtime < time() - 12 * HOUR_IN_SECONDS ) {
                $this->delete_tree( $dir );
            }
        }
    }

    /** @return void */
    private function delete_tree( $path ) {
        if ( ! is_dir( $path ) ) {
            return;
        }

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator( $path, \FilesystemIterator::SKIP_DOTS ),
            \RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ( $iterator as $item ) {
            if ( $item->isDir() && ! $item->isLink() ) {
                @rmdir( $item->getPathname() );
            } else {
                @unlink( $item->getPathname() );
            }
        }
        @rmdir( $path );
    }

    /**
     * Write common web-server deny files. The build also lives in a random
     * token directory and is streamed only through an authenticated admin-post
     * action.
     *
     * @param string $dir Directory.
     * @return void
     */
    private function write_protection_files( $dir ) {
        if ( ! is_dir( $dir ) ) {
            return;
        }
        @file_put_contents( $dir . '/index.php', "<?php\n// Silence is golden.\n" );
        @file_put_contents( $dir . '/.htaccess', "Deny from all\n" );
        @file_put_contents(
            $dir . '/web.config',
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<configuration><system.webServer><authorization><deny users=\"*\" /></authorization></system.webServer></configuration>\n"
        );
    }

    /** @return array */
    private function result( $status, $label, $message ) {
        return array(
            'status'  => $status,
            'label'   => $label,
            'message' => $message,
        );
    }
}
