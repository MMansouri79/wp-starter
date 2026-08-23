<?php
namespace MMS\SiteStarter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Runner {
    /**
     * Build a queue where every potentially slow operation gets its own request.
     *
     * @param string   $profile_id Profile key.
     * @param string[] $components Selected components.
     * @param string   $site_language keep|fa_IR|en_US.
     * @return array[]
     */
    public function build_queue( $profile_id, array $components, $site_language = 'keep' ) {
        $profiles = Config::get( 'profiles', array() );
        if ( empty( $profiles[ $profile_id ] ) ) {
            return array();
        }

        $profile          = $profiles[ $profile_id ];
        $definitions      = Config::get( 'plugins', array() );
        $queue            = array();
        $effective_locale = 'keep' === $site_language ? get_locale() : $site_language;

        if ( 'keep' !== $site_language ) {
            $languages = Config::get( 'site_languages', array() );
            $queue[] = array(
                'type'   => 'language',
                'locale' => $site_language,
                'label'  => 'Site language: ' . ( isset( $languages[ $site_language ] ) ? $languages[ $site_language ] : $site_language ),
            );
        }

        if ( in_array( 'theme', $components, true ) ) {
            $theme   = Config::get( 'theme', array() );
            $queue[] = array(
                'type'  => 'theme',
                'label' => ! empty( $theme['name'] ) ? 'Theme: ' . $theme['name'] : 'Theme',
            );
        }

        if ( in_array( 'plugins', $components, true ) ) {
            foreach ( $profile['plugins'] as $plugin_id ) {
                $definition = isset( $definitions[ $plugin_id ] ) ? $definitions[ $plugin_id ] : array();
                if ( ! empty( $definition['locales'] ) && is_array( $definition['locales'] ) && ! in_array( $effective_locale, $definition['locales'], true ) ) {
                    continue;
                }

                $plugin_name = ! empty( $definition['name'] ) ? $definition['name'] : $plugin_id;
                $queue[]     = array(
                    'type'      => 'plugin',
                    'plugin_id' => $plugin_id,
                    'label'     => 'Plugin: ' . $plugin_name,
                );
            }
        }

        $component_labels = array(
            'wordpress'       => 'WordPress baseline',
            'plugin-settings' => 'Reviewed plugin defaults',
            'cleanup'         => 'Default-content cleanup',
            'pages'           => 'Starter pages',
            'elementor'       => 'Elementor defaults',
        );

        foreach ( $component_labels as $component => $label ) {
            if ( in_array( $component, $components, true ) ) {
                $queue[] = array(
                    'type'  => $component,
                    'label' => $label,
                );
            }
        }

        return $queue;
    }

    /**
     * Execute one queue item only.
     *
     * @param string $profile_id Profile key.
     * @param array  $step Queue item.
     * @return array[]
     */
    public function run_step( $profile_id, array $step ) {
        $profiles = Config::get( 'profiles', array() );
        if ( empty( $profiles[ $profile_id ] ) ) {
            return array( $this->result( 'error', 'Setup', 'Unknown starter profile.' ) );
        }

        $profile = $profiles[ $profile_id ];
        $type    = isset( $step['type'] ) ? $step['type'] : '';

        switch ( $type ) {
            case 'language':
                $manager = new Settings_Manager();
                return $manager->apply_site_language( isset( $step['locale'] ) ? $step['locale'] : 'keep' );

            case 'theme':
                $manager = new Theme_Manager();
                return $manager->ensure_theme();

            case 'plugin':
                if ( empty( $step['plugin_id'] ) ) {
                    return array( $this->result( 'error', 'Plugin', 'Plugin queue item is missing its ID.' ) );
                }
                $manager = new Plugin_Manager();
                return $manager->ensure_plugins( array( $step['plugin_id'] ) );

            case 'wordpress':
                $manager = new Settings_Manager();
                return $manager->apply_wordpress_defaults();

            case 'plugin-settings':
                $manager = new Plugin_Settings_Manager();
                return $manager->apply_defaults();

            case 'cleanup':
                $manager = new Settings_Manager();
                return $manager->clean_default_content();

            case 'pages':
                $manager = new Page_Manager();
                return $manager->apply( $profile );

            case 'elementor':
                $manager = new Elementor_Manager();
                return $manager->apply_defaults();
        }

        return array( $this->result( 'error', 'Setup', 'Unknown setup queue item.' ) );
    }

    /**
     * A theme/plugin/language step must succeed before the queue auto-advances.
     * Other configuration steps can finish with warnings and still advance.
     *
     * @param array   $step Queue item.
     * @param array[] $results Step results.
     * @return bool
     */
    public function step_is_blocking_failure( array $step, array $results ) {
        $type = isset( $step['type'] ) ? $step['type'] : '';
        $critical = in_array( $type, array( 'language', 'theme', 'plugin' ), true );

        foreach ( $results as $row ) {
            $status = isset( $row['status'] ) ? $row['status'] : 'error';
            if ( 'error' === $status ) {
                return true;
            }
            if ( $critical && 'success' !== $status ) {
                return true;
            }
        }

        return false;
    }

    /**
     * Persist successful completion metadata.
     *
     * @param string   $profile_id Profile key.
     * @param string[] $components Selected components.
     * @param string   $site_language Selected language.
     * @return void
     */
    public function finish( $profile_id, array $components, $site_language = 'keep' ) {
        update_option(
            'mss_last_setup_run',
            array(
                'version'       => MSS_VERSION,
                'profile'       => $profile_id,
                'components'    => array_values( $components ),
                'site_language' => $site_language,
                'timestamp'     => time(),
            ),
            false
        );
    }

    /**
     * Legacy synchronous runner retained for compatibility.
     *
     * @param string   $profile_id Profile key.
     * @param string[] $components Selected components.
     * @param string   $site_language Selected language.
     * @return array[]
     */
    public function run( $profile_id, array $components, $site_language = 'keep' ) {
        $queue   = $this->build_queue( $profile_id, $components, $site_language );
        $results = array();

        if ( empty( $queue ) ) {
            return array( $this->result( 'error', 'Setup', 'Unknown starter profile or no setup components were selected.' ) );
        }

        foreach ( $queue as $step ) {
            $step_results = $this->run_step( $profile_id, $step );
            $results = array_merge( $results, $step_results );
            if ( $this->step_is_blocking_failure( $step, $step_results ) ) {
                break;
            }
        }

        $this->finish( $profile_id, $components, $site_language );
        return $results;
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
