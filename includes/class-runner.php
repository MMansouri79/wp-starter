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
     * @return array[]
     */
    public function build_queue( $profile_id, array $components ) {
        $profiles = Config::get( 'profiles', array() );
        if ( empty( $profiles[ $profile_id ] ) ) {
            return array();
        }

        $profile     = $profiles[ $profile_id ];
        $definitions = Config::get( 'plugins', array() );
        $queue       = array();

        if ( in_array( 'theme', $components, true ) ) {
            $theme   = Config::get( 'theme', array() );
            $queue[] = array(
                'type'  => 'theme',
                'label' => ! empty( $theme['name'] ) ? 'Theme: ' . $theme['name'] : 'Theme',
            );
        }

        if ( in_array( 'plugins', $components, true ) ) {
            foreach ( $profile['plugins'] as $plugin_id ) {
                $plugin_name = ! empty( $definitions[ $plugin_id ]['name'] ) ? $definitions[ $plugin_id ]['name'] : $plugin_id;
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
     * Persist successful completion metadata.
     *
     * @param string   $profile_id Profile key.
     * @param string[] $components Selected components.
     * @return void
     */
    public function finish( $profile_id, array $components ) {
        update_option(
            'mss_last_setup_run',
            array(
                'version'    => MSS_VERSION,
                'profile'    => $profile_id,
                'components' => array_values( $components ),
                'timestamp'  => time(),
            ),
            false
        );
    }

    /**
     * Legacy synchronous runner retained for compatibility.
     * New admin setup uses build_queue() + run_step() to avoid gateway timeouts.
     *
     * @param string   $profile_id Profile key.
     * @param string[] $components Selected components.
     * @return array[]
     */
    public function run( $profile_id, array $components ) {
        $queue   = $this->build_queue( $profile_id, $components );
        $results = array();

        if ( empty( $queue ) ) {
            return array( $this->result( 'error', 'Setup', 'Unknown starter profile or no setup components were selected.' ) );
        }

        foreach ( $queue as $step ) {
            $results = array_merge( $results, $this->run_step( $profile_id, $step ) );
        }

        $this->finish( $profile_id, $components );
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
